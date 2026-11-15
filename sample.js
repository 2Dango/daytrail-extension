import { calendarDay, createSummary } from './analytics.js';

const topics = [
  'best trails near Toronto', 'how to make cold brew', 'CSS container queries',
  'Ottawa weekend itinerary', 'jazz playlists for work', 'how to prune basil',
  'baked miso salmon recipe', 'Chrome extension permissions', 'beginner film photography',
  'public libraries open Sunday', 'watercolour paper sizes', 'day trips by train',
  'how to make an oat latte', 'sunset time this weekend', 'independent bookshops',
];

const sites = [
  'github.com', 'github.com', 'youtube.com', 'youtube.com', 'wikipedia.org',
  'wikipedia.org', 'figma.com', 'reddit.com', 'developer.mozilla.org', 'nytimes.com',
  'alltrails.com', 'are.na', 'store.steampowered.com', 'unsplash.com', 'archive.org',
  'openstreetmap.org', 'letterboxd.com', 'bandcamp.com', 'weather.gc.ca', 'torontopubliclibrary.ca',
  'npr.org', 'tvo.org', 'stackoverflow.com', 'music.apple.com', 'goodreads.com',
];

export function sampleHistory(days, now = Date.now()) {
  const summary = createSummary(days, now);
  const rhythm = [36, 52, 43, 64, 48, 28, 39, 58, 66, 47, 76, 54, 33, 40, 63, 84, 65];
  for (let offset = 1 - days; offset <= 0; offset += 1) {
    const date = calendarDay(now, offset);
    let seed = Math.floor(date / 86400000) >>> 0;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const count = rhythm[seed % rhythm.length] + Math.floor(random() * 13);
    const end = Math.min(now, new Date(date).setHours(22, 15));
    for (let visit = 0; visit < count; visit += 1) {
      const pick = random();
      const time = Math.round(date + (end - date) * (0.25 + 0.75 * visit / count));
      if (pick < 0.22) {
        const query = topics[Math.floor(random() * topics.length)];
        summary.add({ site: 'google.com', query }, time);
      } else {
        const siteIndex = Math.floor(random() ** 2.2 * sites.length);
        summary.add({ site: sites[siteIndex], query: '' }, time);
      }
    }
  }

  return { ...summary.result(), trackingSince: calendarDay(now, -61), sample: true };
}
