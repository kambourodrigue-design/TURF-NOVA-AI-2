import { Sale, Expense, Customer, Supplier, Product, CreditScoreResult, CreditScoreFactor } from '../types';
import { calculateSummaryForPeriod, localDay } from './financials';

export function calculateCreditScore(
  sales: Sale[],
  expenses: Expense[],
  customers: Customer[],
  products: Product[],
  isFormalized: boolean = false,
  suppliers: Supplier[] = []
): CreditScoreResult {
  const summary30d = calculateSummaryForPeriod(sales, expenses, 30);
  
  // 1. Régularité des flux d'encaissement (250 pts max)
  // Analyse des jours de vente sur les 30 derniers jours
  const cutoff30 = Date.now() - 30 * 86400000;
  const uniqueSalesDays = new Set(
    sales.filter(s => s.status !== 'cancelled' && new Date(s.date).getTime() >= cutoff30).map(s => localDay(s.date))
  ).size;
  
  let fluxScore = 0;
  if (uniqueSalesDays >= 20) fluxScore = 250;
  else if (uniqueSalesDays >= 14) fluxScore = 200;
  else if (uniqueSalesDays >= 7) fluxScore = 140;
  else fluxScore = Math.min(uniqueSalesDays * 20, 100);

  const fluxFactor: CreditScoreFactor = {
    id: 'cashflow_regularity',
    name: "Régularité des encaissements",
    score: fluxScore,
    maxScore: 250,
    weight: 25,
    status: fluxScore >= 200 ? 'excellent' : fluxScore >= 140 ? 'good' : 'average',
    feedback: `${uniqueSalesDays} jours de vente actifs enregistrés sur le dernier mois. Un flux régulier rassure les institutions de crédit.`,
    recommendation: uniqueSalesDays < 20 ? "Enregistrez chaque jour même les petites ventes pour prouver la constance de votre activité." : "Excellente discipline d'enregistrement quotidien !"
  };

  // 2. Marge nette et rentabilité réelle (200 pts max)
  let marginScore = 0;
  if (summary30d.netMarginPct >= 20) marginScore = 200;
  else if (summary30d.netMarginPct >= 12) marginScore = 165;
  else if (summary30d.netMarginPct >= 5) marginScore = 120;
  else if (summary30d.netMarginPct > 0) marginScore = 80;
  else marginScore = 20;

  const marginFactor: CreditScoreFactor = {
    id: 'profitability',
    name: "Rentabilité & Marge nette",
    score: marginScore,
    maxScore: 200,
    weight: 20,
    status: marginScore >= 165 ? 'excellent' : marginScore >= 120 ? 'good' : marginScore >= 80 ? 'average' : 'poor',
    feedback: `Marge nette estimée à ${summary30d.netMarginPct.toFixed(1)}%. Bénéfice net mensuel : ${Math.round(summary30d.netProfit)} F CFA.`,
    recommendation: summary30d.netMarginPct < 15 ? "Optimisez vos coûts d'approvisionnement ou limitez les dépenses imprévues pour dégager au moins 15% de marge." : "Marge saine permettant le remboursement aisé d'échéances de prêt."
  };

  // 3. Maîtrise des créances clients & dettes fournisseurs / BFR (200 pts max)
  const totalCustomerDebt = customers.reduce((sum, c) => sum + c.totalDebt, 0);
  const totalSupplierDebt = suppliers.reduce((sum, s) => sum + s.totalDebt, 0);
  const debtToRevenueRatio = summary30d.revenue > 0 ? (totalCustomerDebt / summary30d.revenue) : 0;
  const supplierDebtToRevenueRatio = summary30d.revenue > 0 ? (totalSupplierDebt / summary30d.revenue) : 0;
  
  let debtScore = 140;
  // Customer receivables score
  if (debtToRevenueRatio <= 0.15) debtScore += 40;
  else if (debtToRevenueRatio <= 0.30) debtScore += 20;
  else if (debtToRevenueRatio > 0.50) debtScore -= 30;

  // Supplier debt score (manageable trade credit is good, but exceeding 40% of monthly sales is risky)
  if (totalSupplierDebt === 0) {
    debtScore += 20; // Zero debt
  } else if (supplierDebtToRevenueRatio <= 0.35) {
    debtScore += 20; // Healthy trade credit
  } else {
    debtScore -= 30; // Heavy supplier debt burden
  }

  debtScore = Math.max(30, Math.min(200, debtScore));

  const debtFactor: CreditScoreFactor = {
    id: 'receivables_management',
    name: "Créances Clients & Dettes Fournisseurs",
    score: debtScore,
    maxScore: 200,
    weight: 20,
    status: debtScore >= 160 ? 'excellent' : debtScore >= 120 ? 'good' : debtScore >= 80 ? 'average' : 'poor',
    feedback: `Créances clients : ${totalCustomerDebt} F CFA | Dettes fournisseurs : ${totalSupplierDebt} F CFA. Solde net : ${(totalCustomerDebt - totalSupplierDebt >= 0 ? '+' : '')}${totalCustomerDebt - totalSupplierDebt} F CFA.`,
    recommendation: totalSupplierDebt > totalCustomerDebt 
      ? "Vos dettes grossistes dépassent vos créances clients. Priorisez l'apurement des grossistes pour conserver vos lignes de crédit commercial." 
      : debtToRevenueRatio > 0.25 
        ? "Relancez vos clients débiteurs par WhatsApp avant d'accorder de nouveaux crédits." 
        : "Équilibre sain entre crédits clients et dettes fournisseurs."
  };

  // 4. Gestion et valeur du stock marchand (150 pts max)
  const totalStockValue = products.reduce((acc, p) => acc + (p.stockQuantity * p.purchasePrice), 0);
  const outOfStockCount = products.filter(p => p.stockQuantity === 0).length;
  const lowStockCount = products.filter(p => p.stockQuantity > 0 && p.stockQuantity <= p.minAlertThreshold).length;

  let stockScore = 150;
  if (outOfStockCount > 2) stockScore -= 50;
  if (lowStockCount > 3) stockScore -= 30;
  if (totalStockValue < 100000) stockScore -= 40;
  stockScore = Math.max(30, stockScore);

  const stockFactor: CreditScoreFactor = {
    id: 'stock_security',
    name: "Couverture & Valeur du Stock",
    score: stockScore,
    maxScore: 150,
    weight: 15,
    status: stockScore >= 120 ? 'excellent' : stockScore >= 90 ? 'good' : 'average',
    feedback: `Valeur du stock marchand : ${Math.round(totalStockValue)} F CFA. ${outOfStockCount} rupture(s), ${lowStockCount} stock(s) bas.`,
    recommendation: outOfStockCount > 0 ? "Réapprovisionnez les produits en rupture pour éviter la perte de chiffre d'affaires." : "Stock bien géré qui constitue une garantie matérielle pour le banquier."
  };

  // 5. Assiduité et maturité des données (100 pts max)
  let disciplineScore = 50;
  if (sales.length >= 30) disciplineScore += 30;
  if (expenses.length >= 5) disciplineScore += 20;

  const disciplineFactor: CreditScoreFactor = {
    id: 'governance',
    name: "Rigueur comptable & Traçabilité",
    score: disciplineScore,
    maxScore: 100,
    weight: 10,
    status: disciplineScore >= 80 ? 'excellent' : 'good',
    feedback: `${sales.length} ventes et ${expenses.length} dépenses tracées avec détail des coûts.`,
    recommendation: "Continuez d'archiver vos transactions chaque semaine."
  };

  // 6. Digitalisation des paiements (100 pts max)
  let digitalScore = 40;
  if (summary30d.digitalPaymentsRatio >= 40) digitalScore = 100;
  else if (summary30d.digitalPaymentsRatio >= 20) digitalScore = 80;
  else if (summary30d.digitalPaymentsRatio >= 10) digitalScore = 60;

  // Bonus formalisation
  if (isFormalized) {
    digitalScore = Math.min(100, digitalScore + 20);
  }

  const digitalFactor: CreditScoreFactor = {
    id: 'digital_traceability',
    name: "Part Mobile Money & Digital",
    score: digitalScore,
    maxScore: 100,
    weight: 10,
    status: digitalScore >= 80 ? 'excellent' : digitalScore >= 60 ? 'good' : 'average',
    feedback: `${summary30d.digitalPaymentsRatio.toFixed(0)}% des encaissements effectués via Wave, Orange Money ou MTN.`,
    recommendation: "Encourager les clients à payer par Mobile Money fournit des relevés certifiés incontestables pour la banque."
  };

  const totalScore = Math.min(1000, fluxScore + marginScore + debtScore + stockScore + disciplineScore + digitalScore);

  let rating: 'A+' | 'A' | 'B' | 'C' | 'D' = 'B';
  let label = "Solvabilité Modérée";
  let color = "text-amber-600 bg-amber-50 border-amber-200";
  let riskAssessment = "Risque modéré mais finançable avec suivi ou microcrédit progressif.";
  let eligibilityVerdict: 'HIGHLY_ELIGIBLE' | 'ELIGIBLE_WITH_CONDITIONS' | 'NEED_MORE_HISTORY' | 'HIGH_RISK' = 'ELIGIBLE_WITH_CONDITIONS';

  if (totalScore >= 820) {
    rating = 'A+';
    label = "Excellente Solvabilité";
    color = "text-emerald-700 bg-emerald-50 border-emerald-300";
    riskAssessment = "Profil hautement prioritaire pour prêts bancaires et lignes de crédit de campagne.";
    eligibilityVerdict = 'HIGHLY_ELIGIBLE';
  } else if (totalScore >= 700) {
    rating = 'A';
    label = "Très Solide & Finançable";
    color = "text-teal-700 bg-teal-50 border-teal-300";
    riskAssessment = "Dossier très favorable pour microfinance (Cofina, Baobab, Advans, ACEP).";
    eligibilityVerdict = 'HIGHLY_ELIGIBLE';
  } else if (totalScore >= 550) {
    rating = 'B';
    label = "Finançable sous conditions";
    color = "text-amber-700 bg-amber-50 border-amber-300";
    riskAssessment = "Éligible au microcrédit de fonds de roulement avec cautionnement simple.";
    eligibilityVerdict = 'ELIGIBLE_WITH_CONDITIONS';
  } else if (totalScore >= 400) {
    rating = 'C';
    label = "En consolidation";
    color = "text-orange-700 bg-orange-50 border-orange-300";
    riskAssessment = "Dossier nécessitant 30 jours supplémentaires de rigueur et d'apurement des dettes.";
    eligibilityVerdict = 'NEED_MORE_HISTORY';
  } else {
    rating = 'D';
    label = "Risque Élevé";
    color = "text-rose-700 bg-rose-50 border-rose-300";
    riskAssessment = "Score insuffisant : prioriser le recouvrement des impayés et la rentabilité.";
    eligibilityVerdict = 'HIGH_RISK';
  }

  // Capacité de remboursement mensuel = 35% du bénéfice net mensuel
  const monthlyCapacity = Math.max(0, summary30d.netProfit * 0.35);
  // Montant prêt max conseillé sur 12 mois
  const rawLoan = monthlyCapacity * 10;
  const loanStep = rawLoan >= 200000 ? 50000 : 10000;   // arrondi adapté à la taille du prêt
  const maxRecommendedLoan = Math.round(rawLoan / loanStep) * loanStep;

  return {
    totalScore,
    rating,
    label,
    color,
    riskAssessment,
    maxRecommendedLoan,   // 0 si aucune capacité de remboursement
    maxMonthlyPayment: Math.round(monthlyCapacity),
    factors: [fluxFactor, marginFactor, debtFactor, stockFactor, disciplineFactor, digitalFactor],
    eligibilityVerdict,
  };
}
