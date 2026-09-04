/**
 * Structural-wrapper classification for ETFs, by fund-name keywords.
 * Returns a category label or null. Stocks are never wrappers.
 */
const RULES: Array<[string, RegExp]> = [
  ["leveraged", /\b(?:[1-5](?:\.[0-9])?x|ultra(?:pro)?|ultrashort|ultra short|leveraged|daily (?:[a-z0-9&.\- ]+ )?(?:bull|bear)|\bbull\b|\bbear\b|2x|3x)\b/i],
  ["inverse", /\b(?:inverse|-1x|short (?!term|-term|duration|maturity|dated|dur)(?:[a-z0-9&.\- ]+)?(?:etf|fund|shares|index|s&p|nasdaq|russell|dow)|proshares short|direxion daily)\b/i],
  ["option-income", /\b(?:covered call|buy-?write|buywrite|premium income|income advantage|option income|options? strategy|yieldmax|enhanced income|equity premium|call writ(?:e|ing)|collar)\b/i],
  ["buffer", /\b(?:buffer|defined outcome|defined-outcome|managed floor|floor etf|innovator|power buffer|hedged equity)\b/i],
  ["target-date", /\b(?:target date|target-date|target retirement|lifepath|20[2-6][05] (?:fund|etf|target))\b/i],
  ["vix", /\b(?:vix|volatility index|s&p 500 vix|vxx|uvxy|svix|uvix)\b/i],
];

export function classifyWrapper(name: string, kind: "stock" | "etf"): string | null {
  if (kind !== "etf") return null;
  const n = name.replace(/\s+/g, " ");
  for (const [label, re] of RULES) {
    if (re.test(n)) return label;
  }
  return null;
}

const ISSUERS: Array<[RegExp, string]> = [
  [/\bstate street spdr\b|\bspdr\b/i, "SPDR"],
  [/\bishares\b/i, "iShares"],
  [/\bvanguard\b/i, "Vanguard"],
  [/\binvesco\b/i, "Invesco"],
  [/\bschwab\b/i, "Schwab"],
  [/\bvaneck\b/i, "VanEck"],
  [/\bglobal x\b/i, "Global X"],
  [/\bproshares\b/i, "ProShares"],
  [/\bdirexion\b/i, "Direxion"],
  [/\bfirst trust\b/i, "First Trust"],
  [/\bwisdomtree\b/i, "WisdomTree"],
  [/\bfidelity\b/i, "Fidelity"],
  [/\bdimensional\b/i, "Dimensional"],
  [/\bavantis\b/i, "Avantis"],
  [/\bjpmorgan\b|\bjp morgan\b/i, "JPMorgan"],
  [/\bgoldman sachs\b/i, "Goldman Sachs"],
  [/\bamplify\b/i, "Amplify"],
  [/\bgrayscale\b/i, "Grayscale"],
  [/\bark\b/i, "ARK"],
  [/\bpacer\b/i, "Pacer"],
  [/\bfranklin\b/i, "Franklin"],
  [/\bvictoryshares\b/i, "VictoryShares"],
  [/\bxtrackers\b/i, "Xtrackers"],
  [/\bnuveen\b/i, "Nuveen"],
  [/\bputnam\b/i, "Putnam"],
  [/\bbny mellon\b/i, "BNY Mellon"],
  [/\bcambria\b/i, "Cambria"],
  [/\bsei\b/i, "SEI"],
  [/\bgmo\b/i, "GMO"],
  [/\bcapital group\b/i, "Capital Group"],
  [/\bt\. ?rowe\b/i, "T. Rowe Price"],
  [/\bpimco\b/i, "PIMCO"],
  [/\bjanus\b/i, "Janus Henderson"],
  [/\bab\b|\balliancebernstein\b/i, "AllianceBernstein"],
  [/\bkraneshares\b/i, "KraneShares"],
  [/\broundhill\b/i, "Roundhill"],
  [/\byieldmax\b/i, "YieldMax"],
  [/\bdefiance\b/i, "Defiance"],
  [/\binnovator\b/i, "Innovator"],
  [/\bsimplify\b/i, "Simplify"],
  [/\balps\b/i, "ALPS"],
  [/\bflexshares\b/i, "FlexShares"],
  [/\bbondbloxx\b/i, "BondBloxx"],
  [/\bsprott\b/i, "Sprott"],
  [/\babrdn\b/i, "abrdn"],
  [/\bteucrium\b/i, "Teucrium"],
  [/\bunited states (?:oil|gasoline|natural gas|commodity|copper|brent|12 month)\b|\buscf\b/i, "US Commodity Funds"],
  [/\bbitwise\b/i, "Bitwise"],
  [/\bvolatility shares\b/i, "Volatility Shares"],
];

/** Fund issuer, used as the "industry" column for ETFs. Falls back to the first word of the name. */
export function etfIssuer(name: string): string {
  for (const [re, label] of ISSUERS) if (re.test(name)) return label;
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first.replace(/[^A-Za-z0-9&.-]/g, "") || "Other";
}
