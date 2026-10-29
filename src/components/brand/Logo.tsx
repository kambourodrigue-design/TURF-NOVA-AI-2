import React from 'react';

export type LogoVariant = 'stacked' | 'horizontal' | 'mark' | 'wordmark';
/** Fond sur lequel le logo est posé : 'dark' = fond sombre, 'light' = fond clair, 'auto' = suit le thème clair/nuit de l'application. */
export type LogoOn = 'dark' | 'light' | 'auto';

interface Props { variant?: LogoVariant; on?: LogoOn; className?: string; alt?: string }

/** Logo Nafora en 4 formes (empilé, horizontal, symbole, mot) et 2 teintes (fond clair / fond sombre). `className` règle la taille (ex. « h-9 »). */
export const Logo: React.FC<Props> = ({ variant = 'horizontal', on = 'auto', className = 'h-9', alt = 'Nafora' }) => {
  const src = (tone: 'light' | 'dark') => `/brand/${variant === 'stacked' ? 'logo-stacked' : variant === 'horizontal' ? 'logo-horizontal' : variant}-${tone}.png`;
  const cls = `${className} w-auto max-w-full object-contain select-none`;
  if (on === 'dark' || on === 'light') return <img src={src(on)} alt={alt} className={cls} draggable={false} />;
  return (
    <>
      <img src={src('light')} alt={alt} className={`${cls} logo-on-light`} draggable={false} />
      <img src={src('dark')} alt="" aria-hidden className={`${cls} logo-on-dark`} draggable={false} />
    </>
  );
};
