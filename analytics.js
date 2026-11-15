// Country domains from https://www.google.com/supported_domains.
const googleSuffixes = new Set(`
  com ad ae com.af com.ag al am co.ao com.ar as at com.au az ba com.bd be
  bf bg com.bh bi bj com.bn com.bo com.br bs bt co.bw by com.bz ca cd cf cg
  ch ci co.ck cl cm cn com.co co.cr com.cu cv com.cy cz de dj dk dm com.do
  dz com.ec ee com.eg es com.et fi com.fj fm fr ga ge gg com.gh com.gi gl
  gm gr com.gt gy com.hk hn hr ht hu co.id ie co.il im co.in iq is it je
  com.jm jo co.jp co.ke com.kh ki kg co.kr com.kw kz la com.lb li lk co.ls
  lt lu lv com.ly co.ma md me mg mk ml com.mm mn com.mt mu mv mw com.mx
  com.my co.mz com.na com.ng com.ni ne nl no com.np nr nu co.nz com.om
  com.pa com.pe com.pg com.ph com.pk pl pn com.pr ps pt com.py com.qa ro
  ru rw com.sa com.sb sc se com.sg sh si sk com.sl sn so sm sr st com.sv
  td tg co.th com.tj tl tm tn to com.tr tt com.tw co.tz com.ua co.ug co.uk
  com.uy co.uz com.vc co.ve co.vi com.vn vu ws rs co.za co.zm co.zw cat
`.trim().split(/\s+/));

const ignoredTransitions = new Set(['reload', 'auto_subframe', 'manual_subframe', 'keyword_generated']);
const recentLimit = 6;
const favoriteLimit = 5;

export function calendarDay(time, offset = 0) {
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + offset);
  return day.getTime();
}

export function describeUrl(rawUrl) {
  if (!rawUrl) return null;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!['https:', 'http:'].includes(url.protocol)) return null;

  const site = url.hostname.replace(/^www\./, '').replace(/\.$/, '');
  const isGoogle = site.startsWith('google.') && googleSuffixes.has(site.slice(7));
  const isSearch = isGoogle && ['/search', '/search/'].includes(url.pathname);
  const query = isSearch ? (url.searchParams.get('q') ?? '').trim() : '';
  return { site, query };
}

export function createSummary(days, now = Date.now()) {
  const timeline = Array.from({ length: days }, (_, index) => ({
    date: calendarDay(now, index + 1 - days),
    visits: 0,
    searches: 0,
  }));
  const buckets = new Map(timeline.map((day) => [day.date, day]));
  const sites = new Map();
  const recent = [];
  const start = timeline[0].date;
  let visits = 0;
  let searches = 0;

  return {
    start,
    add(website, time, transition) {
      if (!Number.isFinite(time) || time < start || time > now || ignoredTransitions.has(transition)) return;
      const day = buckets.get(calendarDay(time));
      if (!day) return;

      visits += 1;
      day.visits += 1;
      sites.set(website.site, (sites.get(website.site) ?? 0) + 1);
      if (!website.query) return;

      searches += 1;
      day.searches += 1;
      if (recent.length < recentLimit || time > recent.at(-1).time) {
        recent.push({ query: website.query, time });
        recent.sort((left, right) => right.time - left.time);
        if (recent.length > recentLimit) recent.pop();
      }
    },
    result() {
      const favorites = Array.from(sites, ([site, count]) => ({ site, count }))
        .sort((left, right) => right.count - left.count || left.site.localeCompare(right.site))
        .slice(0, favoriteLimit);
      return { start, now, visits, searches, sites: sites.size, timeline, favorites, recent };
    },
  };
}

export async function readHistory(history, days, { now = Date.now(), active = () => true } = {}) {
  const summary = createSummary(days, now);
  // Chrome uses 0 as the uncapped result count. getVisits supplies the individual timestamps.
  const entries = await history.search({ text: '', startTime: summary.start, endTime: now + 1, maxResults: 0 });
  const urls = Array.from(new Set(entries.map(({ url }) => url)));
  let next = 0;
  let failed = false;

  async function readNextUrls() {
    while (!failed && active() && next < urls.length) {
      const url = urls[next++];
      const website = describeUrl(url);
      if (!website) continue;

      try {
        const visits = await history.getVisits({ url });
        if (!active() || failed) return;
        for (const visit of visits) {
          summary.add(website, visit.visitTime, visit.transition);
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(12, urls.length) }, readNextUrls));
  return summary.result();
}
