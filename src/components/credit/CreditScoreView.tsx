import React, { useState } from 'react';
import { CreditScoreResult, ShopSettings, Sale, Expense, Product, Customer, Supplier } from '../../types';
import { formatCurrency } from '../../services/financials';
import { BankDossierModal } from './BankDossierModal';
import { 
  Landmark, 
  ShieldCheck, 
  HelpCircle, 
  ChevronRight, 
  Calculator, 
  FileText, 
  CheckCircle, 
  AlertTriangle, 
  ArrowUpRight,
  TrendingUp,
  Sparkles
} from 'lucide-react';
import { Select } from '../common/dialogs';

interface CreditScoreViewProps {
  creditScore: CreditScoreResult;
  settings: ShopSettings;
  sales: Sale[];
  expenses: Expense[];
  products: Product[];
  customers: Customer[];
  suppliers?: Supplier[];
  onNavigateToFormalization: () => void;
}

export const CreditScoreView: React.FC<CreditScoreViewProps> = ({
  creditScore,
  settings,
  sales,
  expenses,
  products,
  customers,
  suppliers = [],
  onNavigateToFormalization,
}) => {
  const [isDossierOpen, setIsDossierOpen] = useState(false);

  // Loan simulator state
  const [loanAmount, setLoanAmount] = useState<number>(creditScore.maxRecommendedLoan || 1000000);
  const [loanMonths, setLoanMonths] = useState<number>(12);
  const [interestRateMonthly, setInterestRateMonthly] = useState<number>(1.5); // 1.5% par mois standard microfinance

  // Calculate monthly repayment
  // Formule mensualité: M = P * [r / (1 - (1+r)^-n)]
  const monthlyRate = (interestRateMonthly / 100);
  const calculatedMonthlyPayment = loanAmount > 0 && loanMonths > 0 
    ? Math.round((loanAmount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -loanMonths)))
    : 0;
  
  const isLoanSustainable = calculatedMonthlyPayment <= creditScore.maxMonthlyPayment;

  return (
    <div className="space-y-6 pb-20">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-stone-900 tracking-tight">
            Score de Crédit & Financement PME
          </h2>
          <p className="text-xs sm:text-sm text-stone-500">
            Algorithme de solvabilité pour commerces informels et PME d'Afrique de l'Ouest.
          </p>
        </div>

        <button
          onClick={() => setIsDossierOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-bold text-sm shadow-sm transition active:scale-95 shrink-0"
        >
          <FileText className="w-4 h-4 text-amber-400" />
          <span>Dossier Bancaire PDF</span>
        </button>
      </div>

      {/* Main Score Hero Card */}
      <div className="bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-950 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          
          {/* Left: Score Badge & Classification */}
          <div className="space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold bg-amber-400 text-stone-950">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>INDICE DE CONFIANCE BANCAIRE</span>
            </div>

            <div className="flex items-baseline gap-3">
              <div className="text-5xl sm:text-6xl font-black tracking-tight text-white font-mono-num">
                {creditScore.totalScore}
              </div>
              <div className="text-stone-400 text-base font-semibold">
                / 1000 pts
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-xl text-sm font-extrabold bg-white/20 text-white backdrop-blur-xs border border-white/20">
                Classe {creditScore.rating} : {creditScore.label}
              </span>
            </div>

            <p className="text-xs sm:text-sm text-emerald-100/90 max-w-md leading-relaxed">
              {creditScore.riskAssessment}
            </p>
          </div>

          {/* Right: Loan capacity callout */}
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-5 border border-white/15 space-y-3 md:min-w-[280px]">
            <div className="text-xs uppercase font-extrabold tracking-wider text-amber-300">
              Capacité d'Emprunt Conseillée
            </div>

            <div className="text-2xl sm:text-3xl font-black text-white font-mono-num">
              {formatCurrency(creditScore.maxRecommendedLoan, settings.currency)}
            </div>

            <div className="text-xs text-emerald-200 border-t border-white/10 pt-2 flex justify-between">
              <span>Mensualité soutenable :</span>
              <span className="font-bold text-white font-mono-num">
                {formatCurrency(creditScore.maxMonthlyPayment, settings.currency)}/mois
              </span>
            </div>

            <button
              onClick={() => setIsDossierOpen(true)}
              className="w-full mt-2 py-2 rounded-xl bg-amber-400 hover:bg-amber-500 text-stone-950 font-black text-xs transition shadow-sm"
            >
              Imprimer le Dossier de Prêt
            </button>
          </div>

        </div>
      </div>

      {/* 6 Credit Factors Diagnostic Breakdown */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-stone-200 shadow-xs space-y-4">
        <div>
          <h3 className="font-extrabold text-stone-900 text-base sm:text-lg">
            Analyse Détaillée des 6 Critères d'Éligibilité
          </h3>
          <p className="text-xs text-stone-500">
            Voici les points analysés par les analystes de crédit des microfinances (Cofina, Baobab, Advans, etc.).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
          {creditScore.factors.map((factor) => {
            const pct = (factor.score / factor.maxScore) * 100;
            const isGood = factor.score >= (factor.maxScore * 0.7);

            return (
              <div 
                key={factor.id}
                className="p-4 rounded-2xl border border-stone-200 bg-stone-50/60 hover:bg-white hover:border-emerald-200 transition space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs sm:text-sm text-stone-900">{factor.name}</span>
                  <div className="flex items-center gap-1.5 font-mono-num font-black text-xs">
                    <span className={isGood ? 'text-emerald-700' : 'text-amber-600'}>
                      {factor.score}
                    </span>
                    <span className="text-stone-400">/{factor.maxScore} pts</span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-stone-200 h-2 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all ${isGood ? 'bg-emerald-700' : 'bg-amber-500'}`}
                    style={{ width: `${Math.max(5, pct)}%` }}
                  />
                </div>

                <p className="text-xs text-stone-600 leading-snug">
                  {factor.feedback}
                </p>

                <div className="p-2 rounded-xl bg-white border border-stone-200 text-[11px] text-stone-700 flex items-start gap-1.5">
                  <span className="font-bold text-emerald-800 shrink-0">Action :</span>
                  <span>{factor.recommendation}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Microfinance & Bank Loan Simulator */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-stone-200 shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-800 flex items-center justify-center">
            <Calculator className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-extrabold text-stone-900 text-base">
              Simulateur de Remboursement de Prêt
            </h3>
            <p className="text-xs text-stone-500">
              Testez vos mensualités selon votre capacité réelle de trésorerie.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          
          {/* Montant */}
          <div>
            <label className="text-xs font-bold text-stone-700">Montant souhaité ({settings.currency})</label>
            <input
              type="number"
              step="50000"
              value={loanAmount}
              onChange={(e) => setLoanAmount(Number(e.target.value))}
              className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl font-mono-num font-bold text-sm text-stone-900"
            />
            <div className="flex gap-1.5 mt-1.5 overflow-x-auto text-[10px]">
              {[500000, 1000000, 2000000, 3000000].map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setLoanAmount(v)}
                  className="px-2 py-0.5 rounded bg-stone-100 hover:bg-stone-200 font-mono-num shrink-0"
                >
                  {(v / 1000).toLocaleString('fr-FR')}k
                </button>
              ))}
            </div>
          </div>

          {/* Durée */}
          <div>
            <label className="text-xs font-bold text-stone-700">Durée du prêt</label>
            <Select
              value={loanMonths}
              onChange={(e) => setLoanMonths(Number(e.target.value))}
              className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs sm:text-sm font-medium"
            >
              <option value={3}>3 mois (Crédit court terme / Campagne)</option>
              <option value={6}>6 mois (Fonds de roulement)</option>
              <option value={12}>12 mois (1 an)</option>
              <option value={18}>18 mois (1 an et demi)</option>
              <option value={24}>24 mois (2 ans)</option>
            </Select>
          </div>

          {/* Taux */}
          <div>
            <label className="text-xs font-bold text-stone-700">Taux mensuel indicatif</label>
            <Select
              value={interestRateMonthly}
              onChange={(e) => setInterestRateMonthly(Number(e.target.value))}
              className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs sm:text-sm font-medium"
            >
              <option value={1.0}>1.0% / mois (Banque commerciale)</option>
              <option value={1.5}>1.5% / mois (Microfinance standard - Cofina, Baobab)</option>
              <option value={2.0}>2.0% / mois (Microcrédit rapide)</option>
            </Select>
          </div>

        </div>

        {/* Simulation Verdict */}
        <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          isLoanSustainable 
            ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950' 
            : 'bg-rose-50/80 border-rose-300 text-rose-950'
        }`}>
          <div>
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider">
              {isLoanSustainable ? <CheckCircle className="w-4 h-4 text-emerald-700" /> : <AlertTriangle className="w-4 h-4 text-rose-600" />}
              <span>{isLoanSustainable ? "Prêt Soutenable & Recommandé" : "Mensualité Trop Élevée pour la Trésorerie"}</span>
            </div>
            <p className="text-xs mt-1">
              Mensualité estimée : <strong>{formatCurrency(calculatedMonthlyPayment, settings.currency)} / mois</strong> pendant {loanMonths} mois.
              (Votre capacité max est de {formatCurrency(creditScore.maxMonthlyPayment, settings.currency)}).
            </p>
          </div>

          <button
            onClick={() => setIsDossierOpen(true)}
            className="px-4 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-bold text-xs sm:text-sm transition shrink-0"
          >
            Constituer le dossier
          </button>
        </div>

      </div>

      {/* Formalization Callout */}
      {!settings.isFormalized && (
        <div className="p-5 rounded-3xl bg-amber-500/10 border border-amber-300/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h4 className="font-extrabold text-stone-900 text-sm sm:text-base flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-600" />
              <span>Augmentez votre score de +150 points avec le statut d'Entreprenant</span>
            </h4>
            <p className="text-xs text-stone-600 max-w-xl">
              En Afrique de l'Ouest (OHADA), l'enregistrement RCCM sous le statut d'entreprenant est gratuit ou à coût minime (10 000 F CFA) et ouvre directement les portes des crédits bancaires à taux réduit.
            </p>
          </div>
          <button
            onClick={onNavigateToFormalization}
            className="px-4 py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs sm:text-sm transition shrink-0"
          >
            Découvrir le guide
          </button>
        </div>
      )}

      {/* Modal for official Dossier */}
      {isDossierOpen && (
        <BankDossierModal
          creditScore={creditScore}
          settings={settings}
          sales={sales}
          expenses={expenses}
          products={products}
          customers={customers}
          suppliers={suppliers}
          onClose={() => setIsDossierOpen(false)}
        />
      )}

    </div>
  );
};
