import React from 'react';
import { ShopSettings } from '../../types';
import { 
  ShieldCheck, 
  CheckCircle2, 
  Circle, 
  ExternalLink, 
  HelpCircle, 
  ArrowRight,
  Landmark,
  Building,
  Award,
  Sparkles
} from 'lucide-react';

interface FormalizationGuideProps {
  settings: ShopSettings;
  onUpdateSettings: (settings: ShopSettings) => void;
}

export const FormalizationGuide: React.FC<FormalizationGuideProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const steps = [
    {
      id: 'step-1',
      title: "1. Obtenir le Statut d'Entreprenant (RCCM)",
      desc: "Prévu par l'acte uniforme OHADA, le statut d'entreprenant est simple, rapide et quasi-gratuit pour les commerçants indépendants (formalité au CEPICI en Côte d'Ivoire, APIX au Sénégal, API au Bénin/Togo, etc.).",
      benefit: "Protège légalement votre nom commercial et vous donne un numéro RCCM officiel.",
      completed: !!settings.rccmNumber || settings.isFormalized,
    },
    {
      id: 'step-2',
      title: "2. Régime Fiscal Forfaitaire (Taxe Synthétique)",
      desc: "Pour les petits commerces, le fisc propose la taxe synthétique ou l'impôt libératoire. Vous payez un montant fixe modeste chaque trimestre sans obligation de bilan comptable complexe.",
      benefit: "Évite les fermetures inopinées de boutique et les amendes de contrôle fiscal inopiné.",
      completed: !!settings.taxId,
    },
    {
      id: 'step-3',
      title: "3. Séparer les Comptes : Compte Marchand / Pro",
      desc: "Ouvrez un compte bancaire PME ou un compte marchand Wave Business / Orange Money Pro au nom de votre boutique avec votre numéro RCCM.",
      benefit: "Vos relevés deviennent des preuves officielles pour toute demande de prêt.",
      completed: settings.isFormalized,
    },
    {
      id: 'step-4',
      title: "4. Tenue Quotidienne des Registres sur Nafora",
      desc: "En enregistrant chaque vente, chaque approvisionnement et chaque dette sur Nafora, vous disposez d'un historique inattaquable.",
      benefit: "Calcul automatique du score de crédit bancaire et génération du dossier de prêt en 1 clic.",
      completed: true,
    },
    {
      id: 'step-5',
      title: "5. Couverture Maladie & Retraite (CMU / CNPS)",
      desc: "Souscrivez aux régimes de sécurité sociale pour travailleurs indépendants (ex: RSTI de la CNPS en Côte d'Ivoire, IPRES au Sénégal).",
      benefit: "Sécurité pour vous et votre famille en cas de maladie ou d'arrêt de travail.",
      completed: false,
    },
  ];

  const handleToggleFormalized = () => {
    onUpdateSettings({
      ...settings,
      isFormalized: !settings.isFormalized,
    });
  };

  return (
    <div className="space-y-6 pb-20">
      
      {/* Top Header */}
      <div>
        <h2 className="text-xl sm:text-2xl font-black text-stone-900 tracking-tight">
          Passerelle Formelle : Du Marché Informel à la PME Reconnue
        </h2>
        <p className="text-xs sm:text-sm text-stone-500">
          Guide pas-à-pas pour formaliser votre commerce en Afrique de l'Ouest (OHADA) sans payer trop d'impôts.
        </p>
      </div>

      {/* Hero Banner */}
      <div className="bg-gradient-to-r from-emerald-900 to-teal-900 rounded-3xl p-6 text-white shadow-md relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-400 text-stone-950 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                <span>POURQUOI SE FORMALISER ?</span>
              </span>
            </div>
            <h3 className="text-lg sm:text-xl font-black text-white">
              Accédez aux marchés publics, aux financements bancaires et aux subventions d'État
            </h3>
            <p className="text-xs sm:text-sm text-emerald-100 max-w-xl">
              Plus de 80% des commerçants d'Afrique de l'Ouest travaillent dans l'informel. Pourtant, le statut d'entreprenant OHADA a été créé spécialement pour vous donner une existence légale sans bureaucratie étouffante.
            </p>
          </div>

          <button
            onClick={handleToggleFormalized}
            className={`px-4 py-3 rounded-2xl font-bold text-xs sm:text-sm transition shrink-0 flex items-center gap-2 shadow-sm ${
              settings.isFormalized
                ? 'bg-amber-400 text-stone-950 hover:bg-amber-500'
                : 'bg-white text-emerald-950 hover:bg-stone-100'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{settings.isFormalized ? "Statut : Formalisé (RCCM)" : "Déclarer mon entreprise formalisée"}</span>
          </button>
        </div>
      </div>

      {/* Step by step interactive roadmap */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-stone-200 shadow-xs space-y-4">
        <h3 className="font-extrabold text-stone-900 text-base">
          La Feuille de Route du Commerçant
        </h3>

        <div className="space-y-3.5">
          {steps.map((step, idx) => (
            <div 
              key={step.id}
              className={`p-4 rounded-2xl border transition ${
                step.completed 
                  ? 'bg-emerald-50/50 border-emerald-200' 
                  : 'bg-stone-50 border-stone-200'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  {step.completed ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-stone-400 flex items-center justify-center text-[10px] font-bold text-stone-500">
                      {idx + 1}
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <h4 className="font-extrabold text-sm text-stone-900">{step.title}</h4>
                    {step.completed && (
                      <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                        Validé
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-600 leading-relaxed">{step.desc}</p>
                  <div className="p-2 rounded-xl bg-white border border-stone-200 text-[11px] text-stone-700 font-medium">
                    <strong className="text-emerald-800">Avantage clé :</strong> {step.benefit}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Contacts & Guichets Uniques par Pays */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-stone-200 shadow-xs space-y-3">
        <h3 className="font-extrabold text-stone-900 text-base flex items-center gap-2">
          <Building className="w-4 h-4 text-emerald-800" />
          <span>Où se Renseigner selon votre Pays ?</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-1 text-xs">
          <div className="p-3 bg-stone-50 rounded-2xl border border-stone-200 space-y-1">
            <span className="font-bold text-stone-900">🇨🇮 Côte d'Ivoire</span>
            <p className="text-stone-600">Guichet Unique du CEPICI ou Greffe du Tribunal du commerce d'Abidjan.</p>
            <div className="text-[10px] text-emerald-800 font-semibold">Statut d'entreprenant : Déclaration simple</div>
          </div>

          <div className="p-3 bg-stone-50 rounded-2xl border border-stone-200 space-y-1">
            <span className="font-bold text-stone-900">🇸🇳 Sénégal</span>
            <p className="text-stone-600">APIX (Guichet Unique de Création d'Entreprise) ou Chambres de Commerce régionales.</p>
            <div className="text-[10px] text-emerald-800 font-semibold">NINEA & Registre de commerce</div>
          </div>

          <div className="p-3 bg-stone-50 rounded-2xl border border-stone-200 space-y-1">
            <span className="font-bold text-stone-900">🇧🇫 Burkina Faso</span>
            <p className="text-stone-600">Maison de l'Entreprise du Burkina Faso (MEBF) et CEFORE.</p>
            <div className="text-[10px] text-emerald-800 font-semibold">Centre de formalités des entreprises</div>
          </div>

          <div className="p-3 bg-stone-50 rounded-2xl border border-stone-200 space-y-1">
            <span className="font-bold text-stone-900">🇲🇱 Mali</span>
            <p className="text-stone-600">Agence pour la Promotion des Investissements (API-Mali) et CCIM.</p>
            <div className="text-[10px] text-emerald-800 font-semibold">Guichet unique d'enregistrement</div>
          </div>

          <div className="p-3 bg-stone-50 rounded-2xl border border-stone-200 space-y-1">
            <span className="font-bold text-stone-900">🇹🇬 Togo</span>
            <p className="text-stone-600">Centre de Formalités des Entreprises (CFE Togo).</p>
            <div className="text-[10px] text-emerald-800 font-semibold">Formalisation en moins de 24h</div>
          </div>

          <div className="p-3 bg-stone-50 rounded-2xl border border-stone-200 space-y-1">
            <span className="font-bold text-stone-900">🇧🇯 Bénin</span>
            <p className="text-stone-600">Agence de Promotion des Investissements et des Exportations (APIEx).</p>
            <div className="text-[10px] text-emerald-800 font-semibold">Numéro IFU et RCCM informatisé</div>
          </div>
        </div>
      </div>

    </div>
  );
};
