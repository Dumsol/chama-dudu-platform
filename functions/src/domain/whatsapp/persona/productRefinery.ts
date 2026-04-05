/**
 * Maps common beverage brands and variations to normalized display names.
 * Helps with both NLU fallback (keyword detection) and UI consistency.
 */
export const PRODUCT_MAP: Record<string, string> = {
  // Cervejas
  "heineken": "Cerveja Heineken",
  "stella": "Cerveja Stella Artois",
  "brahma": "Cerveja Brahma",
  "skol": "Cerveja Skol",
  "budweiser": "Cerveja Budweiser",
  "bud": "Cerveja Budweiser",
  "corona": "Cerveja Corona",
  "eisenbahn": "Cerveja Eisenbahn",
  "antarctica": "Cerveja Antarctica",
  "original": "Cerveja Original",
  "spaten": "Cerveja Spaten",
  "cerveja": "Cerveja",
  "breja": "Cerveja",
  "gelada": "Cerveja Gelada",
  "loira": "Cerveja",
  "chope": "Chopp",
  "chopp": "Chopp",

  // Vodkas & Destilados
  "smirnoff": "Vodka Smirnoff",
  "absolut": "Vodka Absolut",
  "natasha": "Vodka Natasha",
  "pitu": "Cachaça Pitú",
  "51": "Cachaça 51",
  "barreiro": "Cachaça Velho Barreiro",
  "destilado": "Destilado",
  "vodka": "Vodka",
  "cachaca": "Cachaça",
  "pinga": "Cachaça",

  // Whiskies
  "whisky": "Whisky",
  "whiskey": "Whisky",
  "red label": "Whisky Red Label",
  "black label": "Whisky Black Label",
  "johnnie walker": "Whisky Johnnie Walker",
  "jack": "Whisky Jack Daniel's",
  "daniels": "Whisky Jack Daniel's",
  "chivas": "Whisky Chivas Regal",
  "ballantines": "Whisky Ballantine's",

  // Ices & Ready-to-drink
  "ice": "Smirnoff Ice",
  "skol-beats": "Skol Beats",
  "beats": "Skol Beats",

  // Refrigerantes & Outros
  "coca": "Coca-Cola",
  "coke": "Coca-Cola",
  "pepsi": "Pepsi",
  "guarana": "Guaraná Antarctica",
  "refrigerante": "Refrigerante",
  "refri": "Refrigerante",
  "suco": "Suco",
  "energetico": "Energético",
  "agua": "Água Mineral",
  "gelo": "Gelo em Cubo",
  "carvao": "Carvão Vegetal",

  // Misspellings Common
  "hineken": "Cerveja Heineken",
  "heineke": "Cerveja Heineken",
  "heinken": "Cerveja Heineken",
  "brauna": "Cerveja Brahma",
  "brahmaa": "Cerveja Brahma",
  "escool": "Cerveja Skol",
  "scol": "Cerveja Skol",
  "budveiser": "Cerveja Budweiser",
  "estela": "Cerveja Stella Artois",
  "stela": "Cerveja Stella Artois",
};

/**
 * Searches the text for known brands and returns the normalized display name.
 */
export function refineProductName(text: string): string | null {
  const lower = text.toLowerCase();
  
  // Try multi-word brands first (more specific)
  const sortedKeys = Object.keys(PRODUCT_MAP).sort((a, b) => b.length - a.length);
  
  for (const key of sortedKeys) {
    if (lower.includes(key)) {
      return PRODUCT_MAP[key];
    }
  }
  
  return null;
}
