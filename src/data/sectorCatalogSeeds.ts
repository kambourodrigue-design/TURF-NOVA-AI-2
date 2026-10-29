import { Product, BusinessCategoryType } from '../types';

export const SECTOR_PRODUCTS_MAP: Record<BusinessCategoryType, Product[]> = {
  retail_food: [
    { id: 'p-rf-1', name: 'Riz Parfumé Jasmin 5kg', category: 'Alimentation', purchasePrice: 3800, sellingPrice: 4700, stockQuantity: 24, minAlertThreshold: 5, unit: 'sac' },
    { id: 'p-rf-2', name: 'Huile Végétale Raffinée 1L', category: 'Alimentation', purchasePrice: 1100, sellingPrice: 1400, stockQuantity: 36, minAlertThreshold: 8, unit: 'bouteille' },
    { id: 'p-rf-3', name: 'Lait Concentré Sucré 397g', category: 'Alimentation', purchasePrice: 650, sellingPrice: 850, stockQuantity: 40, minAlertThreshold: 10, unit: 'boîte' },
    { id: 'p-rf-4', name: 'Pâtes Alimentaires 500g', category: 'Alimentation', purchasePrice: 350, sellingPrice: 500, stockQuantity: 18, minAlertThreshold: 10, unit: 'paquet' },
    { id: 'p-rf-5', name: 'Sucre Blanc en Morceaux 1kg', category: 'Alimentation', purchasePrice: 800, sellingPrice: 1000, stockQuantity: 12, minAlertThreshold: 5, unit: 'paquet' },
    { id: 'p-rf-6', name: 'Savon de Ménage Gros Morceau', category: 'Hygiène & Entretien', purchasePrice: 300, sellingPrice: 450, stockQuantity: 25, minAlertThreshold: 8, unit: 'morceau' },
    { id: 'p-rf-7', name: 'Boisson Gazeuse Canette 33cl', category: 'Boissons', purchasePrice: 400, sellingPrice: 600, stockQuantity: 30, minAlertThreshold: 6, unit: 'canette' },
  ],

  fashion_tailor: [
    { id: 'p-ft-1', name: 'Confection Robe Wax Glamour', category: 'Confection sur mesure', purchasePrice: 5000, sellingPrice: 18000, stockQuantity: 99, minAlertThreshold: 2, unit: 'tenue' },
    { id: 'p-ft-2', name: 'Tissu Wax Véritable Hollandais (6 yards)', category: 'Tissus & Bazin/Wax', purchasePrice: 12000, sellingPrice: 18500, stockQuantity: 14, minAlertThreshold: 4, unit: 'pièce' },
    { id: 'p-ft-3', name: 'Costume Homme Bazin Riche 3 pièces', category: 'Confection sur mesure', purchasePrice: 15000, sellingPrice: 45000, stockQuantity: 99, minAlertThreshold: 2, unit: 'ensemble' },
    { id: 'p-ft-4', name: 'Chemise Homme Col Officier Lin', category: 'Prêt-à-porter', purchasePrice: 6000, sellingPrice: 14000, stockQuantity: 8, minAlertThreshold: 3, unit: 'chemise' },
    { id: 'p-ft-5', name: 'Retouche Ourlet & Rétrécissement Express', category: 'Retouches express', purchasePrice: 200, sellingPrice: 1500, stockQuantity: 999, minAlertThreshold: 10, unit: 'retouche' },
    { id: 'p-ft-6', name: 'Rouleau Fil de Couture Extra Résistant', category: 'Accessoires & Boutons', purchasePrice: 400, sellingPrice: 800, stockQuantity: 45, minAlertThreshold: 10, unit: 'pièce' },
  ],

  hardware_craft: [
    { id: 'p-hc-1', name: 'Ciment Gris CPJ 42.5 (Sac 50kg)', category: 'Gros Œuvre (Ciment/Fer)', purchasePrice: 4200, sellingPrice: 4800, stockQuantity: 85, minAlertThreshold: 20, unit: 'sac 50kg' },
    { id: 'p-hc-2', name: 'Fer à Béton Haute Adhérence Ø 10mm (Barre 12m)', category: 'Gros Œuvre (Ciment/Fer)', purchasePrice: 3100, sellingPrice: 3700, stockQuantity: 60, minAlertThreshold: 15, unit: 'barre 12m' },
    { id: 'p-hc-3', name: 'Peinture Blanche Satinée Intérieur (Seau 15L)', category: 'Peinture & Finition', purchasePrice: 14000, sellingPrice: 19500, stockQuantity: 12, minAlertThreshold: 4, unit: 'seau' },
    { id: 'p-hc-4', name: 'Serrure Canon de Sécurité 3 Clés', category: 'Outillage & Visserie', purchasePrice: 3500, sellingPrice: 5500, stockQuantity: 16, minAlertThreshold: 5, unit: 'pièce' },
    { id: 'p-hc-5', name: 'Rouleau Câble Électrique Rigide 2.5mm² (100m)', category: 'Électricité', purchasePrice: 16000, sellingPrice: 22000, stockQuantity: 7, minAlertThreshold: 3, unit: 'rouleau' },
    { id: 'p-hc-6', name: 'Tuyau PVC Pression Évacuation Ø 100 (4m)', category: 'Plomberie & Sanitaire', purchasePrice: 2800, sellingPrice: 4200, stockQuantity: 22, minAlertThreshold: 6, unit: 'barre' },
  ],

  restaurant_maquis: [
    { id: 'p-rm-1', name: 'Poulet Braisé Entier Assaisonné', category: 'Plats Chauds & Braisés', purchasePrice: 2800, sellingPrice: 5500, stockQuantity: 30, minAlertThreshold: 5, unit: 'plat' },
    { id: 'p-rm-2', name: 'Poisson Carpe Braisée Spéciale (Grande taille)', category: 'Plats Chauds & Braisés', purchasePrice: 3200, sellingPrice: 6500, stockQuantity: 20, minAlertThreshold: 4, unit: 'plat' },
    { id: 'p-rm-3', name: 'Portion Attiéké Huile Rouge / Piment', category: 'Accompagnements (Attiéké/Alloco/Riz)', purchasePrice: 200, sellingPrice: 500, stockQuantity: 50, minAlertThreshold: 10, unit: 'portion' },
    { id: 'p-rm-4', name: 'Portion Alloco Banane Mûre Dorée', category: 'Accompagnements (Attiéké/Alloco/Riz)', purchasePrice: 300, sellingPrice: 800, stockQuantity: 40, minAlertThreshold: 8, unit: 'portion' },
    { id: 'p-rm-5', name: 'Bière Grande Bouteille Fraîche 65cl', category: 'Bières & Vins', purchasePrice: 650, sellingPrice: 1000, stockQuantity: 72, minAlertThreshold: 24, unit: 'bouteille' },
    { id: 'p-rm-6', name: 'Bouteille Jus de Bissap Maison Menthe 50cl', category: 'Boissons Fraîches & Jus', purchasePrice: 250, sellingPrice: 600, stockQuantity: 25, minAlertThreshold: 8, unit: 'bouteille' },
  ],

  beauty_salon: [
    { id: 'p-bs-1', name: 'Tresses Africaines / Nattes Américaines', category: 'Coiffure & Tresses', purchasePrice: 1000, sellingPrice: 10000, stockQuantity: 999, minAlertThreshold: 10, unit: 'prestation' },
    { id: 'p-bs-2', name: 'Paquet Mèches Ondulées Naturelles 22 pouces', category: 'Vente Mèches & Cosmétiques', purchasePrice: 7000, sellingPrice: 13500, stockQuantity: 18, minAlertThreshold: 4, unit: 'paquet mèche' },
    { id: 'p-bs-3', name: 'Défrisage Complet + Soin Protéiné Réparateur', category: 'Coiffure & Tresses', purchasePrice: 1500, sellingPrice: 7000, stockQuantity: 999, minAlertThreshold: 5, unit: 'soin' },
    { id: 'p-bs-4', name: 'Manucure & Pose Vernis Semi-Permanent', category: 'Onglerie & Pédicure', purchasePrice: 800, sellingPrice: 4500, stockQuantity: 999, minAlertThreshold: 5, unit: 'prestation' },
    { id: 'p-bs-5', name: 'Soin Visage Purifiant Anti-Boutons au Karité', category: 'Soins Visage & Corps', purchasePrice: 1200, sellingPrice: 6000, stockQuantity: 999, minAlertThreshold: 5, unit: 'soin' },
    { id: 'p-bs-6', name: 'Pot Beurre de Karité Bio Parfumé 250g', category: 'Vente Mèches & Cosmétiques', purchasePrice: 1000, sellingPrice: 2500, stockQuantity: 20, minAlertThreshold: 5, unit: 'flacon' },
  ],

  garage_mechanic: [
    { id: 'p-gm-1', name: 'Forfait Vidange Moteur 10W40 + Filtre', category: 'Entretien & Vidange', purchasePrice: 14000, sellingPrice: 26000, stockQuantity: 15, minAlertThreshold: 4, unit: 'forfait' },
    { id: 'p-gm-2', name: 'Plaquettes de Frein Avant Berline (Jeu de 4)', category: 'Freinage & Suspension', purchasePrice: 9000, sellingPrice: 16500, stockQuantity: 10, minAlertThreshold: 3, unit: 'jeu' },
    { id: 'p-gm-3', name: 'Bougies d’Allumage Haute Qualité (Pack de 4)', category: 'Pièces Moteur', purchasePrice: 5000, sellingPrice: 9500, stockQuantity: 12, minAlertThreshold: 3, unit: 'jeu' },
    { id: 'p-gm-4', name: 'Batterie Auto 12V 60Ah Garantie 1 an', category: 'Électricité & Batterie', purchasePrice: 28000, sellingPrice: 38000, stockQuantity: 6, minAlertThreshold: 2, unit: 'pièce' },
    { id: 'p-gm-5', name: 'Diagnostic Électronique Valise OBD2', category: 'Entretien & Vidange', purchasePrice: 500, sellingPrice: 8000, stockQuantity: 999, minAlertThreshold: 5, unit: 'intervention' },
    { id: 'p-gm-6', name: 'Pneu Neuf Toutes Saisons 175/70 R13', category: 'Pneumatiques', purchasePrice: 19000, sellingPrice: 26500, stockQuantity: 8, minAlertThreshold: 2, unit: 'pièce' },
  ],

  services_cyber: [
    { id: 'p-sc-1', name: 'Commission Dépôt/Retrait Mobile Money (Palier standard)', category: 'Commissions Mobile Money', purchasePrice: 0, sellingPrice: 500, stockQuantity: 9999, minAlertThreshold: 50, unit: 'commission' },
    { id: 'p-sc-2', name: 'Impression Couleur Document A4 Haute Résolution', category: 'Impressions & Photocopies', purchasePrice: 40, sellingPrice: 150, stockQuantity: 500, minAlertThreshold: 50, unit: 'page' },
    { id: 'p-sc-3', name: 'Photocopie Noir & Blanc Recto-Verso', category: 'Impressions & Photocopies', purchasePrice: 10, sellingPrice: 35, stockQuantity: 1000, minAlertThreshold: 100, unit: 'copie' },
    { id: 'p-sc-4', name: 'Saisie & Mise en Page CV Professionnel', category: 'Saisie & Travaux bureautiques', purchasePrice: 200, sellingPrice: 3000, stockQuantity: 999, minAlertThreshold: 10, unit: 'dossier' },
    { id: 'p-sc-5', name: 'Recharge Pass Internet Mobile (Illimité semaine)', category: 'Vente de Pass & Recharges', purchasePrice: 1900, sellingPrice: 2200, stockQuantity: 50, minAlertThreshold: 10, unit: 'recharge' },
  ],

  health_pharma: [
    { id: 'p-hp-1', name: 'Paracétamol 500mg (Boîte de 20 comprimés)', category: 'Antalgiques & Fièvre', purchasePrice: 350, sellingPrice: 650, stockQuantity: 45, minAlertThreshold: 10, unit: 'boîte' },
    { id: 'p-hp-2', name: 'Alcool Dénaturé à 70° (Flacon 250ml)', category: 'Premiers Secours & Pansements', purchasePrice: 600, sellingPrice: 1100, stockQuantity: 24, minAlertThreshold: 6, unit: 'flacon' },
    { id: 'p-hp-3', name: 'Boîte de Pansements Adhésifs Assortis (x50)', category: 'Premiers Secours & Pansements', purchasePrice: 800, sellingPrice: 1500, stockQuantity: 30, minAlertThreshold: 8, unit: 'boîte' },
    { id: 'p-hp-4', name: 'Complexe Multivitamines & Minéraux Effervescent', category: 'Vitamines & Compléments', purchasePrice: 1500, sellingPrice: 2800, stockQuantity: 18, minAlertThreshold: 5, unit: 'tube' },
    { id: 'p-hp-5', name: 'Savon Antiseptique Dermatologique 100g', category: 'Hygiène & Maternité', purchasePrice: 700, sellingPrice: 1300, stockQuantity: 22, minAlertThreshold: 6, unit: 'pièce' },
  ],

  other: [
    { id: 'p-ot-1', name: 'Prestation de Service Standard', category: 'Prestations', purchasePrice: 1000, sellingPrice: 5000, stockQuantity: 999, minAlertThreshold: 5, unit: 'prestation' },
    { id: 'p-ot-2', name: 'Article Commercial Courant', category: 'Ventes', purchasePrice: 2000, sellingPrice: 3500, stockQuantity: 25, minAlertThreshold: 5, unit: 'pièce' },
  ]
};

export function getSectorProducts(category: BusinessCategoryType): Product[] {
  return SECTOR_PRODUCTS_MAP[category] || SECTOR_PRODUCTS_MAP.other;
}
