// API Nafora — Cloudflare Pages Functions + D1
// Routes : /api/auth/*, /api/sync, /api/team/*, /api/admin/*
// La logique est répartie dans functions/_lib/ (auth, sync, merge, team, admin).

import {
  fail, currentUser, HttpError, type Env,
} from '../_lib/util';
import { register, login, logout, forgot, me, changePassword } from '../_lib/auth';
import { handlePull, handlePush } from '../_lib/sync';
import { handleTeam } from '../_lib/team';
import { handleAi } from '../_lib/ai';
import { logError, health, clientLog, adminMonitor, adminMonitorAction } from '../_lib/monitor';
import { myBilling, submitPayment, adminBilling, publicPlans, mfStart, mfCheck, mfWebhook } from '../_lib/billing';
import { myCatalog, saveCatalog } from '../_lib/catalog';
import { handleImages } from '../_lib/images';
import { myFeedback, submitFeedback, publicTestimonials, adminFeedback } from '../_lib/feedback';
import { hit, adminStats, adminAnnouncements, myAnnouncements, readAnnouncement } from '../_lib/site';
import { adminList, adminExport, adminUser } from '../_lib/admin';

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const parts = ([] as string[]).concat((params.path as string | string[]) || []);
    const route = parts.join('/');
    const m = request.method;

    // protection CSRF : les requêtes qui modifient doivent provenir du même site
    if (m !== 'GET' && m !== 'HEAD') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== new URL(request.url).origin) return fail('Origine refusée.', 403);
    }

    if (route === 'auth/register' && m === 'POST') return await register(request, env);
    if (route === 'auth/login' && m === 'POST') return await login(request, env);
    if (route === 'auth/logout' && m === 'POST') return await logout(request, env);
    if (route === 'auth/forgot' && m === 'POST') return await forgot(request, env);

    if (route === 'hit' && m === 'POST') return await hit(env);
    if (route === 'billing/moneyfusion/webhook' && m === 'POST') return await mfWebhook(request, env);
    if (route === 'plans' && m === 'GET') return await publicPlans(env);
    if (route === 'testimonials' && m === 'GET') return await publicTestimonials(env);
    if (route === 'health' && (m === 'GET' || m === 'HEAD')) return await health(env);

    const user = await currentUser(request, env);
    if (route === 'log' && m === 'POST') return await clientLog(request, env, user);
    if (!user) return fail('Non connecté.', 401);

    if (route === 'auth/me' && m === 'GET') return await me(request, env, user);
    if (route === 'auth/password' && m === 'POST') return await changePassword(request, env, user);

    if (route === 'sync' && m === 'GET') return await handlePull(request, env, user);
    if (route === 'sync' && m === 'POST') return await handlePush(request, env, user);

    // Ancienne synchronisation (versions précédentes de l'application)
    if (route === 'data' && m === 'PUT') {
      return fail("Mise à jour requise : fermez complètement l'application puis rouvrez-la.", 410);
    }

    if (parts[0] === 'images') return await handleImages(request, env, user, parts);

    if (route === 'ai' && m === 'POST') return await handleAi(request, env, user);

    if (route === 'announcements' && m === 'GET') return await myAnnouncements(env, user);
    if (parts[0] === 'announcements' && parts[2] === 'read' && m === 'POST') return await readAnnouncement(env, user, parts[1]);

    if (route === 'catalog' && m === 'GET') return await myCatalog(env, user);
    if (route === 'catalog' && m === 'PUT') return await saveCatalog(request, env, user);

    if (route === 'feedback' && m === 'GET') return await myFeedback(env, user);
    if (route === 'feedback' && m === 'POST') return await submitFeedback(request, env, user);

    if (route === 'billing' && m === 'GET') return await myBilling(env, user);
    if (route === 'billing/pay' && m === 'POST') return await submitPayment(request, env, user);
    if (route === 'billing/moneyfusion/start' && m === 'POST') return await mfStart(request, env, user);
    if (route === 'billing/moneyfusion/check' && m === 'POST') return await mfCheck(env, user);

    if (parts[0] === 'team') return await handleTeam(request, env, user, parts);

    if (parts[0] === 'admin') {
      if (user.role !== 'admin') return fail('Accès réservé aux administrateurs.', 403);
      if (route === 'admin/users' && m === 'GET') return await adminList(request, env);
      if (parts[1] === 'monitor') return parts[2] || m !== 'GET' ? await adminMonitorAction(request, env, parts[2]) : await adminMonitor(env);
      if (parts[1] === 'billing') return await adminBilling(request, env, parts);
      if (route === 'admin/stats' && m === 'GET') return await adminStats(env);
      if (parts[1] === 'announcements') return await adminAnnouncements(request, env, parts[2]);
      if (parts[1] === 'feedback') return await adminFeedback(request, env, parts[2]);
      if (route === 'admin/export' && m === 'GET') return await adminExport(env);
      if (parts[1] === 'users' && parts[2]) return await adminUser(request, env, user, parts[2], parts[3]);
    }
    return fail('Route introuvable.', 404);
  } catch (e: any) {
    if (e instanceof HttpError) {
      if (e.status >= 500) await logError(env, { source: 'server', route: new URL(request.url).pathname, status: e.status, message: e.message });
      return fail(e.message, e.status);
    }
    await logError(env, { source: 'server', route: new URL(request.url).pathname, status: 500, message: e?.message || 'Erreur serveur' });
    return fail('Erreur serveur. Réessayez dans un instant.', 500);
  }
};
