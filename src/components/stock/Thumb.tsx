import React from 'react';
import { usePhotos, photoUrl } from '../../services/photos';

/** Vignette d'un produit : sa photo si elle existe, sinon l'initiale du nom. */
export const Thumb: React.FC<{ id: string; name: string; size?: string }> = ({ id, name, size = 'w-11 h-11' }) => {
  const { map } = usePhotos();
  const v = map[id];
  return v
    ? <img src={photoUrl(id, v)} alt="" loading="lazy" className={`${size} rounded-xl object-cover border border-stone-200 shrink-0`} />
    : <div className={`${size} rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center font-black shrink-0`} aria-hidden="true">{name.trim().charAt(0).toUpperCase() || '·'}</div>;
};
