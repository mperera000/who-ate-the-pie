// Live, real-world conditions for each film. A random real forest is picked, its weather
// right now comes from Open-Meteo (free, no key), and the moon phase is computed. These
// change the rules of the night, and every agent is told about them.

export interface Weather {
  forest: string;
  tempC: number;
  windKmh: number;
  sky: "clear" | "cloudy" | "fog" | "rain" | "snow" | "storm";
  description: string;
  moon: string;
  fullMoon: boolean;
  live: boolean;
  /** what tonight's weather does to the story */
  effects: { powerCut: boolean; moonlight: boolean; fog: boolean; mud: boolean; hungry: boolean };
}

const FORESTS = [
  { name: "Yosemite, California", lat: 37.75, lon: -119.59 },
  { name: "the Black Forest, Germany", lat: 48.3, lon: 8.15 },
  { name: "Hokkaido, Japan", lat: 43.06, lon: 141.35 },
  { name: "the Scottish Highlands", lat: 57.12, lon: -4.71 },
  { name: "Olympic National Forest, Washington", lat: 47.8, lon: -123.6 },
  { name: "Banff, Canada", lat: 51.18, lon: -115.57 },
  { name: "the Carpathian Mountains, Romania", lat: 45.6, lon: 25.0 },
  { name: "Great Smoky Mountains, Tennessee", lat: 35.61, lon: -83.49 },
  { name: "Lapland, Finland", lat: 68.66, lon: 27.55 },
  { name: "Patagonia, Chile", lat: -41.1, lon: -71.5 },
];

function skyFor(code: number): Weather["sky"] {
  if (code >= 95) return "storm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if (code === 45 || code === 48) return "fog";
  if (code >= 2) return "cloudy";
  return "clear";
}

function moonPhase(date = new Date()) {
  const synodic = 29.530588853;
  const known = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
  const age = (((date.getTime() / 86400000 - known) % synodic) + synodic) % synodic;
  const f = age / synodic;
  const name =
    f < 0.03 || f > 0.97 ? "new moon" : f < 0.22 ? "waxing crescent" : f < 0.28 ? "first quarter" : f < 0.47 ? "waxing gibbous" : f < 0.53 ? "full moon" : f < 0.72 ? "waning gibbous" : f < 0.78 ? "last quarter" : "waning crescent";
  return { name, full: f >= 0.44 && f <= 0.56 };
}

export async function liveWeather(): Promise<Weather> {
  const forest = FORESTS[Math.floor(Math.random() * FORESTS.length)];
  const moon = moonPhase();
  let tempC = 4;
  let windKmh = 10;
  let code = 3;
  let live = false;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${forest.lat}&longitude=${forest.lon}&current=temperature_2m,weather_code,wind_speed_10m`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const body = (await res.json()) as { current?: { temperature_2m: number; weather_code: number; wind_speed_10m: number } };
    if (body.current) {
      tempC = Math.round(body.current.temperature_2m);
      windKmh = Math.round(body.current.wind_speed_10m);
      code = body.current.weather_code;
      live = true;
    }
  } catch {
    /* fall back to a mild cloudy night */
  }
  let sky = skyFor(code);
  if (windKmh >= 45 && sky !== "snow") sky = "storm";
  const words = { clear: "clear skies", cloudy: "cloudy", fog: "thick fog", rain: "rain", snow: "snow", storm: "a howling storm" }[sky];
  const effects = {
    powerCut: sky === "storm",
    moonlight: moon.full && (sky === "clear" || sky === "cloudy"),
    fog: sky === "fog",
    mud: sky === "rain",
    hungry: tempC <= 0 || sky === "snow",
  };
  return { forest: forest.name, tempC, windKmh, sky, description: `${tempC}°C, ${words}, wind ${windKmh} km/h, ${moon.name}`, moon: moon.name, fullMoon: moon.full, live, effects };
}

/** One line for every agent's prompt. */
export function weatherRules(w: Weather) {
  const rules: string[] = [];
  if (w.effects.powerCut) rules.push("The storm cuts the power at 2am: anyone downstairs after that moves in total darkness and can't be seen.");
  if (w.effects.moonlight) rules.push("Bright moonlight floods the kitchen: anyone downstairs can be spotted by the next bear who comes down.");
  if (w.effects.fog) rules.push("Fog presses against the windows; it's hard to see anyone.");
  if (w.effects.mud) rules.push("It's raining, so paws are muddy: anyone who goes to the kitchen leaves paw prints unless they clean up.");
  if (w.effects.hungry) rules.push("It's freezing, and freezing bears are extra hungry.");
  return `Tonight's real, live weather at the cabin in ${w.forest}: ${w.description}. ${rules.join(" ")}`.trim();
}

export const WILDCARDS = [
  "Grandma Squirrel arrives two hours early, sniffing the air for pie.",
  "The oven timer goes off. Nobody set it.",
  "A raccoon is spotted at the window, licking its paws.",
  "Baby Bear's tummy rumbles so loudly that everyone turns around.",
  "The cuckoo clock falls off the wall. Stuck inside: a piece of pie crust.",
  "A note slides under the door: 'I know what you did last Thanksgiving.'",
  "The forest guests RSVP: 'Bringing our own pie. Heard yours is missing.'",
];
