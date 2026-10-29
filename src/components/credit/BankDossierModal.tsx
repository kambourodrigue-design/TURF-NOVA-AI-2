import React from 'react';
import { CreditScoreResult, ShopSettings, Sale, Expense, Product, Customer, Supplier } from '../../types';
import { formatCurrency, calculateSummaryForPeriod } from '../../services/financials';
import { Printer, Download, X, Landmark, ShieldCheck, CheckCircle2 } from 'lucide-react';

interface BankDossierModalProps {
  creditScore: CreditScoreResult;
  settings: ShopSettings;
  sales: Sale[];
  expenses: Expense[];
  products: Product[];
  customers: Customer[];
  suppliers?: Supplier[];
  onClose: () => void;
}

export const BankDossierModal: React.FC<BankDossierModalProps> = ({
  creditScore,
  settings,
  sales,
  expenses,
  products,
  customers,
  suppliers = [],
  onClose,
}) => {
  const summary30d = calculateSummaryForPeriod(sales, expenses, 30);
  const totalStockValue = products.reduce((sum, p) => sum + (p.stockQuantity * p.purchasePrice), 0);
  const totalReceivables = customers.reduce((sum, c) => sum + c.totalDebt, 0);
  const totalSupplierDebt = suppliers.reduce((sum, s) => sum + s.totalDebt, 0);
  const netCommercialPosition = totalReceivables - totalSupplierDebt;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto">
      <div className="w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-stone-200 overflow-hidden my-auto animate-in fade-in zoom-in-95 max-h-[92vh] flex flex-col">
        
        {/* Top Action Header */}
        <div className="bg-emerald-950 text-white p-4 flex items-center justify-between no-print shrink-0">
          <div className="flex items-center gap-2">
            <Landmark className="w-5 h-5 text-amber-400" />
            <h3 className="font-extrabold text-base">Dossier Synthétique de Demande de Financement</h3>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-stone-950 font-bold text-xs transition"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimer / PDF</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-stone-400 hover:text-white hover:bg-emerald-900"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Official Document Body */}
        <div className="p-6 sm:p-10 overflow-y-auto print:p-0 print:overflow-visible space-y-6 text-stone-900 font-sans print-card">
          
          {/* Document Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pb-6 border-b-2 border-stone-800">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-emerald-900 text-amber-400 font-black text-xl flex items-center justify-center">
                  S
                </div>
                <div>
                  <h1 className="font-black text-xl text-stone-950 uppercase tracking-tight">
                    {settings.shopName}
                  </h1>
                  <p className="text-xs text-stone-600 font-medium">
                    {settings.businessType} • Établi depuis {settings.foundedYear}
                  </p>
                </div>
              </div>
              <div className="mt-3 text-xs text-stone-600 space-y-0.5">
                <p><strong>Promoteur / Gérant :</strong> {settings.ownerName}</p>
                <p><strong>Localisation :</strong> {settings.city}, {settings.country}</p>
                <p><strong>Téléphone / WhatsApp :</strong> {settings.phone}</p>
                {settings.rccmNumber && <p><strong>N° RCCM :</strong> {settings.rccmNumber}</p>}
              </div>
            </div>

            <div className="bg-stone-50 border border-stone-300 p-4 rounded-2xl text-right sm:min-w-[200px]">
              <div className="text-[11px] uppercase tracking-wider text-stone-500 font-extrabold">
                Score de Crédit PME
              </div>
              <div className="text-3xl font-black text-emerald-900 font-mono-num mt-0.5">
                {creditScore.totalScore} <span className="text-sm font-normal text-stone-500">/1000</span>
              </div>
              <div className="inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                Classe : {creditScore.rating} ({creditScore.label})
              </div>
              <div className="text-[10px] text-stone-500 mt-1">
                Édité le {new Date().toLocaleDateString('fr-FR')}
              </div>
            </div>
          </div>

          {/* Intended Financial Institution Notice */}
          <div className="p-3 bg-stone-100 rounded-xl text-xs text-stone-700">
            <strong>Destinataire :</strong> Comité des Risques et Engagements (Banques & Institutions de Microfinance de l'UEMOA : Cofina, Baobab, Advans, ACEP, Coris, BOA, Société Générale, Ecobank, etc.).
          </div>

          {/* Section 1: Financial Health Statement */}
          <div className="space-y-3">
            <h3 className="font-extrabold text-sm uppercase tracking-wider text-stone-800 border-b border-stone-200 pb-1">
              1. Compte de Résultat d'Exploitation Simplifié (Moyenne 30 jours)
            </h3>
            
            <table className="w-full text-xs sm:text-sm">
              <tbody className="divide-y divide-stone-200">
                <tr>
                  <td className="py-2 text-stone-700 font-medium">Chiffre d'Affaires Encaissé (Ventes)</td>
                  <td className="py-2 text-right font-black font-mono-num text-stone-900">
                    {formatCurrency(summary30d.revenue, settings.currency)}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 text-stone-700 font-medium">(-) Coût d'Achat des Marchandises Vendues (COGS)</td>
                  <td className="py-2 text-right font-bold font-mono-num text-rose-700">
                    -{formatCurrency(summary30d.cogs, settings.currency)}
                  </td>
                </tr>
                <tr className="bg-emerald-50/60 font-bold">
                  <td className="py-2 px-2 text-emerald-900">(=) Marge Commerciale Brute</td>
                  <td className="py-2 px-2 text-right font-black font-mono-num text-emerald-900">
                    {formatCurrency(summary30d.grossProfit, settings.currency)} ({summary30d.grossMarginPct.toFixed(1)}%)
                  </td>
                </tr>
                <tr>
                  <td className="py-2 text-stone-700 font-medium">(-) Charges d'Exploitation (Loyer, transport, factures, salaires)</td>
                  <td className="py-2 text-right font-bold font-mono-num text-rose-700">
                    -{formatCurrency(summary30d.operatingExpenses, settings.currency)}
                  </td>
                </tr>
                <tr className="bg-emerald-900 text-white font-extrabold text-sm sm:text-base">
                  <td className="py-2.5 px-3">(=) Bénéfice Net Mensuel Réel</td>
                  <td className="py-2.5 px-3 text-right font-mono-num">
                    {formatCurrency(summary30d.netProfit, settings.currency)} ({summary30d.netMarginPct.toFixed(1)}%)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Section 2: Assets & Collateral (Garanties, Créances & Dettes Fournisseurs) */}
          <div className="space-y-3">
            <h3 className="font-extrabold text-sm uppercase tracking-wider text-stone-800 border-b border-stone-200 pb-1">
              2. Situation des Actifs, Créances & Dettes Fournisseurs (BFR)
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl">
                <span className="text-stone-500 font-semibold">Stock Marchand Estimé</span>
                <div className="text-base font-black font-mono-num text-stone-900 mt-1">
                  {formatCurrency(totalStockValue, settings.currency)}
                </div>
                <div className="text-[11px] text-stone-500">{products.length} références disponibles</div>
              </div>

              <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl">
                <span className="text-stone-500 font-semibold">Créances Clients</span>
                <div className="text-base font-black font-mono-num text-amber-700 mt-1">
                  {formatCurrency(totalReceivables, settings.currency)}
                </div>
                <div className="text-[11px] text-stone-500">{customers.filter(c => c.totalDebt > 0).length} client(s) débiteur(s)</div>
              </div>

              <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl">
                <span className="text-stone-500 font-semibold">Dettes Grossistes/Fournisseurs</span>
                <div className="text-base font-black font-mono-num text-indigo-700 mt-1">
                  {formatCurrency(totalSupplierDebt, settings.currency)}
                </div>
                <div className="text-[11px] text-stone-500">{suppliers.filter(s => s.totalDebt > 0).length} grossiste(s) à payer</div>
              </div>

              <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl">
                <span className="text-stone-500 font-semibold">Position Nette Commerciale</span>
                <div className={`text-base font-black font-mono-num mt-1 ${netCommercialPosition >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {netCommercialPosition >= 0 ? `+${formatCurrency(netCommercialPosition, settings.currency)}` : formatCurrency(netCommercialPosition, settings.currency)}
                </div>
                <div className="text-[11px] text-stone-500">{netCommercialPosition >= 0 ? 'Créances couvrent les dettes' : 'Dettes supérieures'}</div>
              </div>
            </div>
          </div>

          {/* Section 3: Credit Committee Recommendation */}
          <div className="p-4 rounded-2xl bg-amber-50/80 border border-amber-200 space-y-2">
            <div className="flex items-center gap-2 text-amber-900 font-extrabold text-sm">
              <ShieldCheck className="w-4 h-4 text-amber-700" />
              <span>Avis Technique de Solvabilité & Capacité d'Endettement</span>
            </div>
            
            <p className="text-xs text-amber-900 leading-relaxed">
              {creditScore.riskAssessment}
            </p>

            <div className="pt-2 border-t border-amber-200/60 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-stone-600">Capacité de remboursement mensuelle soutenable :</span>
                <span className="font-extrabold text-stone-900 font-mono-num ml-1">
                  {formatCurrency(creditScore.maxMonthlyPayment, settings.currency)} / mois
                </span>
              </div>
              <div>
                <span className="text-stone-600">Crédit de trésorerie maximum préconisé :</span>
                <span className="font-extrabold text-emerald-800 font-mono-num ml-1">
                  {formatCurrency(creditScore.maxRecommendedLoan, settings.currency)}
                </span>
              </div>
            </div>
          </div>

          {/* Signature Sign-off Block */}
          <div className="pt-6 grid grid-cols-2 gap-8 text-xs text-stone-600 border-t border-stone-200">
            <div>
              <p className="font-bold text-stone-900">Le Promoteur / Commerçant</p>
              <p className="text-[11px] text-stone-500">« Certifié sincère et conforme »</p>
              <div className="mt-8 border-b border-stone-300 w-36" />
              <p className="mt-1 font-semibold">{settings.ownerName}</p>
            </div>

            <div className="text-right">
              <p className="font-bold text-stone-900">Visa de l'Agent de Crédit / Banque</p>
              <p className="text-[11px] text-stone-500">Date et cachet de l'institution</p>
              <div className="mt-8 border-b border-stone-300 w-36 ml-auto" />
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
