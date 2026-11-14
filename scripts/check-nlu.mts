// Prints the command parsed from each phrase:  npx tsx scripts/check-nlu.mts
import { parse } from "../src/lib/voice/nlu";
import { REGIONS } from "../src/lib/regions";
const cases = [
  "Take me to the Amazon.", "Select vegetation.", "Compare historical and recent satellite observations using computer vision.",
  "Reveal NDVI trends across the region.", "Overlay precipitation and soil moisture.", "Calculate the trend slope and statistical significance.",
  "What else should I investigate?", "Take me to the Amazone.", "Fly to Brazil", "show me rainfall in Kerala", "Is the Amazon getting greener?",
  "only summer", "from 2005 to 2020", "last twenty years", "What is NDVI?", "what's a p-value", "is it significant?", "why is this happening",
  "compare with the world", "the second one", "yes", "stop", "go home", "Thank you.", "where does this data come from", "play the arctic story",
  "show me haze", "Take me to Rajastan", "zoom into Punjab", "temperature", "what can I say", "let's look at groundwater in punjab", "take me to Tokyo please",
];
for (const c of cases) console.log(c.padEnd(80), JSON.stringify(parse(c, REGIONS)));
