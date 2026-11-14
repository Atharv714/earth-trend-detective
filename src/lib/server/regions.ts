import type { Region } from "@/lib/types";

// bbox = [lon_min, lat_min, lon_max, lat_max]. Cities use a zero-size box at the point.
const pt = (lat: number, lon: number): Region["bbox"] => [lon, lat, lon, lat];
// POWER README lists boxes as lat_min,lat_max,lon_min,lon_max.
const box = (latMin: number, latMax: number, lonMin: number, lonMax: number): Region["bbox"] => [
  lonMin,
  latMin,
  lonMax,
  latMax,
];

export const REGIONS: Region[] = [
  // Global / continents / special (04_world_giovanni)
  { id: "world", label: "Whole world", bbox: [-180, -90, 180, 90], type: "global" },
  { id: "asia", label: "Asia", bbox: [60, 5, 150, 55], type: "continent" },
  { id: "africa", label: "Africa", bbox: [-20, -35, 52, 37], type: "continent" },
  { id: "europe", label: "Europe", bbox: [-10, 35, 40, 70], type: "continent" },
  { id: "north_america", label: "North America", bbox: [-170, 15, -50, 72], type: "continent" },
  { id: "south_america", label: "South America", bbox: [-82, -56, -34, 13], type: "continent" },
  { id: "arctic", label: "Arctic", bbox: [-180, 66.5, 180, 90], type: "region" },
  { id: "antarctic", label: "Antarctic", bbox: [-180, -90, 180, -60], type: "region" },
  { id: "amazon", label: "Amazon rainforest", bbox: [-75, -15, -45, 5], type: "region" },
  { id: "sahara", label: "Sahara desert", bbox: [-15, 15, 35, 30], type: "region" },
  { id: "wisconsin", label: "Wisconsin, USA", bbox: [-92.9, 42.5, -86.8, 47.1], type: "region", country: "USA" },
  // Oceans
  { id: "bay_of_bengal", label: "Bay of Bengal", bbox: [80, 10, 95, 22], type: "ocean" },
  { id: "arabian_sea", label: "Arabian Sea", bbox: [55, 8, 75, 22], type: "ocean" },
  { id: "north_atlantic", label: "North Atlantic", bbox: [-60, 20, -10, 60], type: "ocean" },
  { id: "pacific_tropics", label: "Tropical Pacific", bbox: [-180, -10, -80, 10], type: "ocean" },
  // India
  { id: "india", label: "India region (box)", bbox: [68, 6, 98, 37], type: "region", country: "India" },
  { id: "punjab", label: "Punjab", bbox: box(29.5, 32.5, 73.9, 76.9), type: "region", country: "India" },
  { id: "rajasthan", label: "Rajasthan", bbox: box(24.5, 30, 69.5, 76.5), type: "region", country: "India" },
  { id: "gangetic_plain", label: "Gangetic Plain", bbox: box(24, 28, 80, 88), type: "region", country: "India" },
  {
    id: "himalaya_uttarakhand_hp",
    label: "Himalaya (Uttarakhand & HP)",
    bbox: box(29.5, 33, 76.5, 80.5),
    type: "region",
    country: "India",
  },
  { id: "northeast", label: "Northeast India", bbox: box(22, 29, 89.5, 97), type: "region", country: "India" },
  { id: "western_ghats", label: "Western Ghats", bbox: box(10, 16, 73, 77), type: "region", country: "India" },
  { id: "andhra_pradesh", label: "Andhra Pradesh", bbox: box(13, 19.5, 77, 84.5), type: "region", country: "India" },
  { id: "kerala", label: "Kerala", bbox: box(8, 12.5, 74.8, 77.5), type: "region", country: "India" },
  { id: "central_india", label: "Central India", bbox: box(20, 25, 76, 83), type: "region", country: "India" },
  { id: "tamil_nadu", label: "Tamil Nadu", bbox: box(8, 13.5, 76.5, 80.5), type: "region", country: "India" },
  // Indian cities (POWER monthly + daily)
  { id: "delhi_ncr", label: "Delhi NCR", bbox: pt(28.61, 77.21), type: "city", country: "India" },
  { id: "mumbai", label: "Mumbai", bbox: pt(19.07, 72.88), type: "city", country: "India" },
  { id: "amaravati", label: "Amaravati", bbox: pt(16.51, 80.52), type: "city", country: "India" },
  { id: "bengaluru", label: "Bengaluru", bbox: pt(12.97, 77.59), type: "city", country: "India" },
  { id: "kolkata", label: "Kolkata", bbox: pt(22.57, 88.36), type: "city", country: "India" },
  { id: "chennai", label: "Chennai", bbox: pt(13.08, 80.27), type: "city", country: "India" },
  // Daily-only locations (03_india_daily_nasa_power)
  { id: "central_nagpur", label: "Nagpur", bbox: pt(21.15, 79.09), type: "city", country: "India" },
  { id: "gangetic_patna", label: "Patna", bbox: pt(25.59, 85.14), type: "city", country: "India" },
  { id: "himalaya_dehradun", label: "Dehradun", bbox: pt(30.32, 78.03), type: "city", country: "India" },
  { id: "kerala_kochi", label: "Kochi", bbox: pt(9.93, 76.27), type: "city", country: "India" },
  { id: "northeast_guwahati", label: "Guwahati", bbox: pt(26.14, 91.74), type: "city", country: "India" },
  { id: "punjab_ludhiana", label: "Ludhiana", bbox: pt(30.9, 75.85), type: "city", country: "India" },
  { id: "rajasthan_jodhpur", label: "Jodhpur", bbox: pt(26.24, 73.02), type: "city", country: "India" },
  { id: "tamilnadu_madurai", label: "Madurai", bbox: pt(9.93, 78.12), type: "city", country: "India" },
  {
    id: "western_ghats_mahabaleshwar",
    label: "Mahabaleshwar",
    bbox: pt(17.92, 73.66),
    type: "city",
    country: "India",
  },
];

export const REGION_BY_ID = new Map(REGIONS.map((r) => [r.id, r]));
