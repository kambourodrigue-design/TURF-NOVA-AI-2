import { BusinessActivityPreset, BusinessCategoryType } from '../types';

export const BUSINESS_PRESETS: Record<BusinessCategoryType, BusinessActivityPreset> = {
  retail_food: {
    id: 'retail_food',
    title: 'Commerce Général & Alimentation',
    icon: '🛒',
    tagline: 'Boutiques de quartier, alimentation générale, supérettes, dépôts de denrées',
    terminology: {
      itemLabel: 'Article',
      itemPlural: 'Articles',
      catalogTitle: 'Rayons & Denrées',
    },
    defaultUnits: ['pièce', 'sac', 'carton', 'bouteille', 'kg', 'paquet', 'litre'],
    suggestedCategories: ['Alimentation', 'Boissons', 'Hygiène & Entretien', 'Épicerie', 'Divers'],
    isServiceOriented: false,
  },

  fashion_tailor: {
    id: 'fashion_tailor',
    title: 'Couture, Mode & Atelier de Confection',
    icon: '👗',
    tagline: 'Ateliers de couture, stylistes, vente de tissus (Wax, Bazin), retouches et prêt-à-porter',
    terminology: {
      itemLabel: 'Tenue / Article',
      itemPlural: 'Tenues & Confections',
      catalogTitle: 'Modèles & Tissus',
    },
    defaultUnits: ['tenue', 'mètre', 'retouche', 'pièce', 'ensemble', 'chemise', 'robe'],
    suggestedCategories: ['Confection sur mesure', 'Tissus & Bazin/Wax', 'Retouches express', 'Prêt-à-porter', 'Accessoires & Boutons'],
    isServiceOriented: true,
  },

  hardware_craft: {
    id: 'hardware_craft',
    title: 'Quincaillerie, BTP & Menuiserie',
    icon: '🔨',
    tagline: 'Vente de ciment, fer, tuyauterie, peinture, outillage, menuiserie bois/alu',
    terminology: {
      itemLabel: 'Matériau / Outil',
      itemPlural: 'Matériaux & Outillages',
      catalogTitle: 'Catalogue Quincaillerie',
    },
    defaultUnits: ['pièce', 'sac 50kg', 'barre 12m', 'pot 5L', 'mètre carré', 'paquet 100 vis', 'rouleau'],
    suggestedCategories: ['Gros Œuvre (Ciment/Fer)', 'Peinture & Finition', 'Plomberie & Sanitaire', 'Électricité', 'Outillage & Visserie'],
    isServiceOriented: false,
  },

  restaurant_maquis: {
    id: 'restaurant_maquis',
    title: 'Restaurant, Maquis & Débit de Boisson',
    icon: '🍽️',
    tagline: 'Maquis, restaurants, gargotes, fast-foods (chawarma, braisé), bars et glaciers',
    terminology: {
      itemLabel: 'Plat / Boisson',
      itemPlural: 'Plats & Consommations',
      catalogTitle: 'Menu & Boissons',
    },
    defaultUnits: ['plat', 'portion', 'bouteille', 'casier', 'canette', 'verre'],
    suggestedCategories: ['Plats Chauds & Braisés', 'Accompagnements (Attiéké/Alloco/Riz)', 'Boissons Fraîches & Jus', 'Bières & Vins', 'Snacks & Desserts'],
    isServiceOriented: false,
  },

  beauty_salon: {
    id: 'beauty_salon',
    title: 'Salon de Coiffure & Esthétique',
    icon: '💇',
    tagline: 'Coiffure dames/hommes, tresses, onglerie, soins de peau et vente de mèches/cosmétiques',
    terminology: {
      itemLabel: 'Prestation / Soin',
      itemPlural: 'Prestations & Soins',
      catalogTitle: 'Carte des Soins & Mèches',
    },
    defaultUnits: ['prestation', 'tresses', 'coupe', 'soin', 'flacon', 'paquet mèche'],
    suggestedCategories: ['Coiffure & Tresses', 'Coupes Hommes / Barbe', 'Onglerie & Pédicure', 'Soins Visage & Corps', 'Vente Mèches & Cosmétiques'],
    isServiceOriented: true,
  },

  garage_mechanic: {
    id: 'garage_mechanic',
    title: 'Garage, Mécanique & Pièces Auto/Moto',
    icon: '🔧',
    tagline: 'Ateliers de réparation auto/moto, vidanges, électricité auto et vente de pièces',
    terminology: {
      itemLabel: 'Pièce / Réparation',
      itemPlural: 'Pièces & Interventions',
      catalogTitle: 'Prestations & Pièces',
    },
    defaultUnits: ['forfait', 'intervention', 'pièce', 'litre huile', 'heure main-d’œuvre', 'jeu'],
    suggestedCategories: ['Entretien & Vidange', 'Freinage & Suspension', 'Pneumatiques', 'Électricité & Batterie', 'Pièces Moteur'],
    isServiceOriented: true,
  },

  services_cyber: {
    id: 'services_cyber',
    title: 'Services, Cyber & Point Mobile Money',
    icon: '📱',
    tagline: 'Agences de transfert d’argent (Wave, OM, MoMo), impressions, bureautique et recharges',
    terminology: {
      itemLabel: 'Service / Commission',
      itemPlural: 'Services & Commissions',
      catalogTitle: 'Services Proposés',
    },
    defaultUnits: ['commission', 'copie', 'page', 'forfait', 'recharge', 'dossier'],
    suggestedCategories: ['Commissions Mobile Money', 'Impressions & Photocopies', 'Saisie & Travaux bureautiques', 'Vente de Pass & Recharges', 'Papeterie'],
    isServiceOriented: true,
  },

  health_pharma: {
    id: 'health_pharma',
    title: 'Dépôt Pharmaceutique & Parapharmacie',
    icon: '💊',
    tagline: 'Dépôts de médicaments essentiels, premiers soins, parapharmacie et matériel médical de base',
    terminology: {
      itemLabel: 'Produit Médical',
      itemPlural: 'Produits Médicaux',
      catalogTitle: 'Médicaments & Soins',
    },
    defaultUnits: ['boîte', 'plaquette', 'flacon', 'tube', 'rouleau', 'sachet'],
    suggestedCategories: ['Antalgiques & Fièvre', 'Premiers Secours & Pansements', 'Hygiène & Maternité', 'Vitamines & Compléments', 'Matériel Médical'],
    isServiceOriented: false,
  },

  other: {
    id: 'other',
    title: 'Autre Activité Économique',
    icon: '🏢',
    tagline: 'Toute autre activité commerciale, artisanale ou de prestation de services',
    terminology: {
      itemLabel: 'Article / Prestation',
      itemPlural: 'Articles & Services',
      catalogTitle: 'Catalogue Général',
    },
    defaultUnits: ['pièce', 'prestation', 'forfait', 'heure', 'lot', 'kg'],
    suggestedCategories: ['Ventes', 'Services', 'Prestations', 'Divers'],
    isServiceOriented: false,
  },
};

export function getPresetForCategory(cat: BusinessCategoryType): BusinessActivityPreset {
  return BUSINESS_PRESETS[cat] || BUSINESS_PRESETS.other;
}
