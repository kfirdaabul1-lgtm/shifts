// ================= Meta campaign structure for the ads agent (owner, Nov 7: "does the agent see how the campaigns are built?") =================
// READ ONLY (ads_read). Once a day (and from adsJob {kind:'struct'}) every Meta connection's ad accounts are read:
// campaigns (objective, budget, bid), ad sets (optimisation goal, budget, audience: ages, genders, places, interests, custom
// audiences, placements), ads (format, headline, text, button) with their last-28-day numbers, and per campaign the last-28-day
// split by age+gender and by placement. Written to metaStruct/{campaignId} (admin only; the agent reads it through a tool).
const r2 = (x) => Math.round(x * 100) / 100;
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const money = (v) => (v == null || v === '' ? null : Math.round(+v) / 100); // Meta budgets are in cents of the account currency
const actVal = (acts, types) => { for (const t of types) { const a = (acts || []).find((x) => x.action_type === t); if (a) return Math.round(+a.value || 0); } return 0; };
const LEAD = ['lead', 'onsite_conversion.lead_grouped'], MSG = ['onsite_conversion.messaging_conversation_started_7d'];
const GENDER = { 1: 'גברים', 2: 'נשים' };

function audience(t) {
  t = t || {}; const g = t.geo_locations || {}, places = [];
  (g.countries || []).forEach((c) => places.push(c));
  (g.regions || []).forEach((r) => places.push(r.name));
  (g.cities || []).forEach((c) => places.push(c.name + (c.radius ? ` +${c.radius}${c.distance_unit === 'mile' ? 'mi' : 'km'}` : '')));
  (g.custom_locations || []).forEach((c) => places.push(`${c.name || 'נקודה'} ${c.radius || ''}${c.distance_unit === 'mile' ? 'mi' : 'km'}`));
  const interests = []; (t.flexible_spec || []).forEach((f) => ['interests', 'behaviors', 'life_events', 'family_statuses', 'work_positions', 'education_statuses'].forEach((k) => (f[k] || []).forEach((x) => interests.push(x.name))));
  const pos = []; ['facebook_positions', 'instagram_positions', 'messenger_positions', 'audience_network_positions'].forEach((k) => (t[k] || []).forEach((p) => pos.push(k.split('_')[0] + ':' + p)));
  return {
    ages: (t.age_min || t.age_max) ? `${t.age_min || 18}-${t.age_max || 65}` : '',
    genders: (t.genders || []).map((x) => GENDER[x] || x).join('/') || 'כולם',
    places: places.slice(0, 15), excludedPlaces: ((t.excluded_geo_locations || {}).cities || []).map((c) => c.name).slice(0, 8),
    interests: [...new Set(interests)].slice(0, 25),
    customAudiences: (t.custom_audiences || []).map((a) => a.name).slice(0, 10), excludedAudiences: (t.excluded_custom_audiences || []).map((a) => a.name).slice(0, 10),
    advantageAudience: !!((t.targeting_automation || {}).advantage_audience), languages: (t.locales || []).length ? t.locales : undefined,
    placements: (t.publisher_platforms || []).length ? { platforms: t.publisher_platforms, positions: pos.slice(0, 20) } : 'Advantage+ (אוטומטי)',
  };
}
function creative(c) {
  c = c || {}; const s = c.object_story_spec || {}, ld = s.link_data || {}, vd = s.video_data || {}, af = c.asset_feed_spec || {};
  const fmt = vd.video_id || c.video_id ? 'video' : (ld.child_attachments || []).length ? 'carousel' : (af.bodies || af.titles) ? 'dynamic' : (c.object_type || '').toLowerCase().includes('video') ? 'video' : 'image';
  const bodies = [c.body, ld.message, vd.message, ...((af.bodies || []).map((b) => b.text))].filter(Boolean);
  const titles = [c.title, ld.name, vd.title, ...((af.titles || []).map((b) => b.text))].filter(Boolean);
  const cta = c.call_to_action_type || (ld.call_to_action || {}).type || (vd.call_to_action || {}).type || ((af.call_to_action_types || [])[0]) || '';
  return { format: fmt, headline: clip(titles[0], 120), text: clip(bodies[0], 400), variants: bodies.length + titles.length > 2 ? bodies.length + titles.length : undefined, cta };
}

// cfg = one connection {token, adAccount, conn:{id,name,venue}}; graphAll(path, token, params) from index.js
async function structOne(db, graphAll, cfg) {
  const accs = String(cfg.adAccount || '').split(/[^0-9]+/).filter(Boolean), out = { campaigns: 0, ads: 0 };
  for (const acc of accs) {
    const A = 'act_' + acc, tok = cfg.token, d28 = { date_preset: 'last_28d' };
    const ins = await graphAll(A + '/insights', tok, { ...d28, level: 'ad', fields: 'ad_id,campaign_id,spend,impressions,clicks,actions', limit: '500' });
    const live = new Set(ins.filter((r) => +r.spend > 0).map((r) => r.campaign_id));
    // what the agency changed (owner, Nov 8): the ad account's activity log, last 21 days → metaActs/{account}
    try {
      const since = Math.floor((Date.now() - 21 * 864e5) / 1000);
      const acts = await graphAll(A + '/activities', tok, { fields: 'event_time,event_type,translated_event_type,object_type,object_name,object_id,extra_data,actor_name', since: String(since), limit: '500' });
      const items = acts.slice(0, 400).map((x) => { let ex = x.extra_data; try { ex = JSON.parse(ex); } catch (e) { } return { at: x.event_time || '', what: clip(x.translated_event_type || x.event_type, 120), type: x.event_type || '', objType: x.object_type || '', obj: clip(x.object_name, 160), objId: x.object_id || '', by: clip(x.actor_name, 60), extra: clip(typeof ex === 'string' ? ex : JSON.stringify(ex || ''), 300) }; });
      await db.doc('metaActs/' + acc).set({ account: acc, metaConn: (cfg.conn || {}).id || '', metaConnName: (cfg.conn || {}).name || '', venue: (cfg.conn || {}).venue || '', items, at: Date.now() });
      out.acts = (out.acts || 0) + items.length;
    } catch (e) { out.actsErr = e.message; }
    const camps = (await graphAll(A + '/campaigns', tok, { fields: 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,bid_strategy,start_time,stop_time', limit: '200' }))
      .filter((c) => live.has(c.id) || c.effective_status === 'ACTIVE');
    if (!camps.length) continue;
    const ids = new Set(camps.map((c) => c.id));
    const sets = (await graphAll(A + '/adsets', tok, { fields: 'id,name,campaign_id,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,bid_strategy,destination_type,targeting', limit: '200' })).filter((s) => ids.has(s.campaign_id));
    const ads = (await graphAll(A + '/ads', tok, { fields: 'id,name,adset_id,campaign_id,effective_status,creative{id,title,body,object_type,call_to_action_type,video_id,asset_feed_spec,object_story_spec}', limit: '200' })).filter((a) => ids.has(a.campaign_id));
    const byAd = {}; ins.forEach((r) => { byAd[r.ad_id] = r; });
    const age = await graphAll(A + '/insights', tok, { ...d28, level: 'campaign', breakdowns: 'age,gender', fields: 'campaign_id,spend,impressions,clicks,actions', limit: '500' }).catch(() => []);
    const plc = await graphAll(A + '/insights', tok, { ...d28, level: 'campaign', breakdowns: 'publisher_platform,platform_position', fields: 'campaign_id,spend,impressions,clicks,actions', limit: '500' }).catch(() => []);
    const row = (r) => { const sp = r2(+r.spend || 0), ld = actVal(r.actions, LEAD), ms = actVal(r.actions, MSG); return { spend: sp, impressions: +r.impressions || 0, clicks: +r.clicks || 0, ctrPct: +r.impressions ? r2((+r.clicks || 0) / r.impressions * 100) : null, leads: ld, msgs: ms, cpl: ld ? r2(sp / ld) : null }; };
    for (const c of camps) {
      const cs = sets.filter((s) => s.campaign_id === c.id), ca = ads.filter((a) => a.campaign_id === c.id);
      const tot = ins.filter((r) => r.campaign_id === c.id).reduce((t, r) => { const x = row(r); return { spend: t.spend + x.spend, leads: t.leads + x.leads, msgs: t.msgs + x.msgs, impressions: t.impressions + x.impressions, clicks: t.clicks + x.clicks }; }, { spend: 0, leads: 0, msgs: 0, impressions: 0, clicks: 0 });
      const doc = {
        name: c.name, metaId: c.id, account: acc, metaConn: (cfg.conn || {}).id || '', metaConnName: (cfg.conn || {}).name || '', venue: (cfg.conn || {}).venue || '',
        campaign: { objective: c.objective || '', status: c.effective_status || c.status || '', dailyBudget: money(c.daily_budget), lifetimeBudget: money(c.lifetime_budget), bid: c.bid_strategy || '', start: (c.start_time || '').slice(0, 10), stop: (c.stop_time || '').slice(0, 10) },
        last28: { ...tot, spend: r2(tot.spend), cpl: tot.leads ? r2(tot.spend / tot.leads) : null },
        adsets: cs.slice(0, 15).map((s) => ({ name: clip(s.name, 120), status: s.effective_status || '', goal: s.optimization_goal || '', dailyBudget: money(s.daily_budget), lifetimeBudget: money(s.lifetime_budget), destination: s.destination_type || '', audience: audience(s.targeting) })),
        ads: ca.slice(0, 30).map((a) => ({ name: clip(a.name, 120), status: a.effective_status || '', adset: clip((cs.find((s) => s.id === a.adset_id) || {}).name, 80), ...creative(a.creative), last28: byAd[a.id] ? row(byAd[a.id]) : null }))
          .sort((x, y) => ((y.last28 || {}).spend || 0) - ((x.last28 || {}).spend || 0)),
        byAgeGender: age.filter((r) => r.campaign_id === c.id).map((r) => ({ age: r.age, gender: r.gender === 'male' ? 'גברים' : r.gender === 'female' ? 'נשים' : r.gender, ...row(r) })).filter((x) => x.spend > 0).sort((x, y) => y.spend - x.spend).slice(0, 16),
        byPlacement: plc.filter((r) => r.campaign_id === c.id).map((r) => ({ platform: r.publisher_platform, position: r.platform_position, ...row(r) })).filter((x) => x.spend > 0).sort((x, y) => y.spend - x.spend).slice(0, 12),
        at: Date.now(),
      };
      await db.doc('metaStruct/' + c.id).set(JSON.parse(JSON.stringify(doc)));
      out.campaigns++; out.ads += doc.ads.length;
    }
  }
  return out;
}
module.exports = { structOne, audience, creative };
