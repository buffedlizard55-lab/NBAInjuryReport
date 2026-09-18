/* =====================================================================================
 * geo.js — city coordinates + travel model (shared by the Node collector and the tests)
 *
 * WHY THIS EXISTS
 *   The brief asks the lineup-impact layer to "factor in the team schedule, and travel
 *   times". Travel is a real, measurable part of an NBA absence: a player on a five-game,
 *   eight-day trip through three time zones has fewer recovery windows than one playing
 *   four home games, and a game-time-decision listing is likelier to resolve to "out" on
 *   the second night of a back-to-back. This module turns two entirely public facts —
 *   the published schedule and the city each game is played in — into distance, time-zone
 *   shift and rest-day numbers.
 *
 * WHAT IT IS NOT
 *   - It is NOT a medical claim. Travel and schedule load never assert severity or cause.
 *   - It is NOT arena-precise. Coordinates are CITY CENTROIDS (2 decimals, ~1 mi of
 *     rounding); the app says "city-to-city great-circle distance" everywhere it prints a
 *     number, never "flight distance" or "team travel miles".
 *   - It is NOT a flight tracker. Estimated travel time is a DOCUMENTED MODEL (see
 *     TRAVEL_MODEL below) with stated assumptions, printed next to every number it
 *     produces. No airline, route, charter or traffic data is available for free, and
 *     pretending otherwise would be fabrication.
 *   - An unknown city stays UNKNOWN. `coordsFor()` returns null and the caller records
 *     `unmappedCity`, so a pre-season game in a city this table has not been verified
 *     against is reported as unmapped instead of being silently approximated.
 *
 * PROVENANCE OF THE CITY LIST
 *   The city/state pairs below are the venue cities the ESPN team-schedule payload itself
 *   reports for NBA home games (observed shape: competitions[0].venue.fullName +
 *   venue.address.{city,state} — see SOURCES `espn-team-schedule-api` on sources.html).
 *   Coordinates are the standard city-centre coordinates for those cities. IANA time zone
 *   ids map each city to a real time zone; the UTC offset is computed at run time from the
 *   runtime's IANA tz database via Intl, so it is correct for the game's own date
 *   (including DST) instead of being hard-coded.
 * ===================================================================================== */
"use strict";

const Geo = (function () {
  /* City key: folded city name only (states/countries are recorded for display and for a
   * mismatch flag, never for the lookup — a feed that writes "PQ" instead of "QC" must not
   * silently drop a whole city). */
  const CITIES = [
    /* --- the 30 NBA home cities --- */
    { city: "Atlanta", state: "GA", lat: 33.75, lon: -84.39, tz: "America/New_York", team: "ATL" },
    { city: "Boston", state: "MA", lat: 42.36, lon: -71.06, tz: "America/New_York", team: "BOS" },
    { city: "Brooklyn", state: "NY", lat: 40.68, lon: -73.94, tz: "America/New_York", team: "BKN" },
    { city: "Charlotte", state: "NC", lat: 35.23, lon: -80.84, tz: "America/New_York", team: "CHA" },
    { city: "Chicago", state: "IL", lat: 41.88, lon: -87.63, tz: "America/Chicago", team: "CHI" },
    { city: "Cleveland", state: "OH", lat: 41.50, lon: -81.69, tz: "America/New_York", team: "CLE" },
    { city: "Dallas", state: "TX", lat: 32.78, lon: -96.80, tz: "America/Chicago", team: "DAL" },
    { city: "Denver", state: "CO", lat: 39.74, lon: -104.99, tz: "America/Denver", team: "DEN" },
    { city: "Detroit", state: "MI", lat: 42.33, lon: -83.05, tz: "America/Detroit", team: "DET" },
    { city: "San Francisco", state: "CA", lat: 37.78, lon: -122.42, tz: "America/Los_Angeles", team: "GSW" },
    { city: "Houston", state: "TX", lat: 29.76, lon: -95.37, tz: "America/Chicago", team: "HOU" },
    { city: "Indianapolis", state: "IN", lat: 39.77, lon: -86.16, tz: "America/Indiana/Indianapolis", team: "IND" },
    { city: "Los Angeles", state: "CA", lat: 34.05, lon: -118.24, tz: "America/Los_Angeles", team: "LAL" },
    { city: "Memphis", state: "TN", lat: 35.15, lon: -90.05, tz: "America/Chicago", team: "MEM" },
    { city: "Miami", state: "FL", lat: 25.76, lon: -80.19, tz: "America/New_York", team: "MIA" },
    { city: "Milwaukee", state: "WI", lat: 43.04, lon: -87.91, tz: "America/Chicago", team: "MIL" },
    { city: "Minneapolis", state: "MN", lat: 44.98, lon: -93.27, tz: "America/Chicago", team: "MIN" },
    { city: "New Orleans", state: "LA", lat: 29.95, lon: -90.07, tz: "America/Chicago", team: "NOP" },
    { city: "New York", state: "NY", lat: 40.71, lon: -74.01, tz: "America/New_York", team: "NYK" },
    { city: "Oklahoma City", state: "OK", lat: 35.47, lon: -97.52, tz: "America/Chicago", team: "OKC" },
    { city: "Orlando", state: "FL", lat: 28.54, lon: -81.38, tz: "America/New_York", team: "ORL" },
    { city: "Philadelphia", state: "PA", lat: 39.95, lon: -75.17, tz: "America/New_York", team: "PHI" },
    { city: "Phoenix", state: "AZ", lat: 33.45, lon: -112.07, tz: "America/Phoenix", team: "PHX" },
    { city: "Portland", state: "OR", lat: 45.52, lon: -122.68, tz: "America/Los_Angeles", team: "POR" },
    { city: "Sacramento", state: "CA", lat: 38.58, lon: -121.49, tz: "America/Los_Angeles", team: "SAC" },
    { city: "Salt Lake City", state: "UT", lat: 40.76, lon: -111.89, tz: "America/Denver", team: "UTA" },
    { city: "San Antonio", state: "TX", lat: 29.42, lon: -98.49, tz: "America/Chicago", team: "SAS" },
    { city: "Toronto", state: "ON", lat: 43.65, lon: -79.38, tz: "America/Toronto", team: "TOR" },
    { city: "Washington", state: "DC", lat: 38.91, lon: -77.04, tz: "America/New_York", team: "WAS" },
    /* --- non-NBA-host venues that appear on league schedules. Each was chosen because the
     *     city is a long-standing NBA venue (pre-season / NBA Global Games / neutral sites).
     *     Anything not on this list is reported UNMAPPED rather than approximated. --- */
    { city: "Las Vegas", state: "NV", lat: 36.17, lon: -115.14, tz: "America/Los_Angeles", team: null },
    { city: "Mexico City", state: "DF", lat: 19.43, lon: -99.13, tz: "America/Mexico_City", team: null },
    { city: "Montreal", state: "QC", lat: 45.50, lon: -73.57, tz: "America/Toronto", team: null },
    { city: "Paris", state: null, lat: 48.86, lon: 2.35, tz: "Europe/Paris", team: null },
    { city: "Abu Dhabi", state: null, lat: 24.45, lon: 54.38, tz: "Asia/Dubai", team: null },
    { city: "Quebec City", state: "PQ", lat: 46.81, lon: -71.21, tz: "America/Toronto", team: null },
    { city: "Seattle", state: "WA", lat: 47.61, lon: -122.33, tz: "America/Los_Angeles", team: null },
    { city: "Vancouver", state: "BC", lat: 49.28, lon: -123.12, tz: "America/Vancouver", team: null },
    /* --- added 2026-09-18 from the LIVE collection run, not from memory: the first schema-3 CI
     *     run reported these four venue cities as unresolved, which is the table doing its job.
     *     Inglewood is the Clippers' arena city (Intuit Dome); Boulder/Ames/Tulsa are neutral
     *     pre-season sites the 2026-27 feed actually uses (CU Events Center, Hilton Coliseum,
     *     BOK Center). Each is a real city on the schedule, so it earns a row — anything not
     *     observed and not a long-standing NBA venue still returns null. --- */
    { city: "Inglewood", state: "CA", lat: 33.96, lon: -118.35, tz: "America/Los_Angeles", team: "LAC" },
    { city: "Boulder", state: "CO", lat: 40.02, lon: -105.27, tz: "America/Denver", team: null },
    { city: "Ames", state: "IA", lat: 42.03, lon: -93.63, tz: "America/Chicago", team: null },
    { city: "Tulsa", state: "OK", lat: 36.15, lon: -95.99, tz: "America/Chicago", team: null }
  ];

  /* Venue-name fallback for games whose venue address arrives EMPTY. Observed live 2026-09-18:
   * the Dallas/Houston pre-season games at "Venetian Arena" carry venue.fullName but no city or
   * state at all. The venue name is itself feed data, so the mapping is written here explicitly
   * (rather than inferred from the name at run time) and every row it resolves is marked
   * `venueNameResolved: true`, so the weaker provenance survives all the way to the UI. */
  const VENUE_CITY = [
    { venue: "venetian arena", city: "Las Vegas", state: "NV", lat: 36.11, lon: -115.17, tz: "America/Los_Angeles" }
  ];

  /* A club's home city can differ from the region name this project uses as its "city" for URL
   * building and display. Five clubs use a REGION there (data.js TEAMS.city), and because the
   * travel-origin fallback needs a real point, an unmapped region silently nulled the first away
   * leg's miles/hours AND every time-zone shift for that team's games. Found in the live 02:52Z
   * snapshot (2026-09-18, GSW: every tzShiftHours null). This table is the mapping. It is used ONLY
   * for geography — the travel-origin fallback and the home time zone — never to rewrite anything
   * the schedule payload says or any URL. */
  const TEAM_HOME_CITY = {
    GSW: "San Francisco",   // TEAMS.city "Golden State"
    IND: "Indianapolis",    // TEAMS.city "Indiana"
    LAC: "Inglewood",       // TEAMS.city "LA"; the Clippers play at Intuit Dome in Inglewood
    MIN: "Minneapolis",     // TEAMS.city "Minnesota"
    UTA: "Salt Lake City"   // TEAMS.city "Utah"
  };

  /* Bump when the CITY/VENUE tables or the travel model change. tools/collect_context.js stamps
   * every schedule capture with this, so derived rows (miles, hours, rest, time zones) can never
   * outlive the logic that produced them. Found the hard way on 2026-09-18: the coordinate fix for
   * Inglewood/Boulder/Ames/Tulsa plus the venue-name fallback did not reach the deployed board,
   * because the 6-hour schedule cache was still serving rows derived by the OLD table and the
   * cache check could only see freshness, not provenance. */
  const MODEL_VERSION = 3;

  /* Deterministic digest of everything that can change a derived number: the city table, the
   * venue table, the team-home mapping and the travel-model constants. tools/impact_test.js hashes
   * it and compares against a recorded value, so editing a table without bumping MODEL_VERSION
   * FAILS the suite instead of leaving stale derived rows in the cache. (Learned the hard way:
   * MODEL_VERSION was bumped for the city-table fix but not for the TEAM_HOME_CITY fix, and the
   * 6-hour cache then served time-zone-less rows for five teams for another cycle.) */
  function tableDigest() {
    const n = v => (typeof v === "number" ? String(v) : String(v == null ? "" : v));
    return [
      CITIES.map(c => [c.city, c.state, n(c.lat), n(c.lon), c.tz].join("~")).join(";"),
      VENUE_CITY.map(v => [v.venue, v.city, n(v.lat), n(v.lon), v.tz].join("~")).join(";"),
      Object.keys(TEAM_HOME_CITY).sort().map(k => k + ">" + TEAM_HOME_CITY[k]).join(";"),
      [n(TRAVEL_MODEL.cruiseMph), n(TRAVEL_MODEL.airportOverheadHours), n(TRAVEL_MODEL.groundThresholdMiles), n(TRAVEL_MODEL.groundMph)].join("~")
    ].join("::");
  }

  /* Documented travel-time model. Every field is an assumption a reader can argue with,
   * which is the point — the UI prints "model" next to the result, never "flight time". */
  const TRAVEL_MODEL = {
    cruiseMph: 450,        // effective gate-to-gate speed including climb/descent, typical of short/medium charters
    airportOverheadHours: 2.0,   // security, boarding, taxi, deplaning, arena-to-airport — a stated allowance, not a measurement
    groundThresholdMiles: 250,   // below this the model assumes a bus/ground trip instead of a charter
    groundMph: 45,         // highway average with traffic/rest stops
    source: "Model constants, hand-set from public schedule geography. No flight-plan, charter or traffic data is used or claimed."
  };

  const EARTH_RADIUS_MILES = 3958.8;

  function foldCity(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  }

  const BY_CITY = new Map(CITIES.map(c => [foldCity(c.city), c]));
  const BY_VENUE = new Map(VENUE_CITY.map(v => [foldCity(v.venue), v]));

  /* null when the city is not in the verified list — callers must record that, not guess. */
  function coordsFor(city, state) {
    const hit = BY_CITY.get(foldCity(city));
    if (!hit) return null;
    const out = { city: hit.city, lat: hit.lat, lon: hit.lon, tz: hit.tz, expectedState: hit.state };
    /* A state/country mismatch is an irregularity worth flagging for review: the same city
     * name in a different region would silently change every distance computed from it. */
    if (state && hit.state && String(state).toUpperCase() !== String(hit.state).toUpperCase()) {
      out.stateMismatch = { feed: String(state).toUpperCase(), table: hit.state };
    }
    return out;
  }

  /* Venue-name lookup, for the (observed) case where the address block is empty. Returns the
   * same shape as coordsFor() plus venueNameResolved so the disclosure cannot be lost. */
  function coordsForVenue(venueName) {
    const hit = BY_VENUE.get(foldCity(venueName));
    if (!hit) return null;
    return { city: hit.city, lat: hit.lat, lon: hit.lon, tz: hit.tz, expectedState: hit.state, venueNameResolved: true, venue: hit.venue };
  }

  /* Home-city coordinates for a team, honouring the arena-city override where one exists. */
  function homeCoords(team) {
    if (!team) return null;
    return coordsFor(TEAM_HOME_CITY[team.abbr] || team.city, null);
  }

  function toRad(d) { return d * Math.PI / 180; }

  /* Great-circle (haversine) distance in miles between two {lat,lon} points. */
  function haversineMiles(a, b) {
    if (!a || !b) return null;
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function round(n, p) { const f = 10 ** p; return Math.round(n * f) / f; }

  /* Estimated travel cost between two mapped cities. Returns null components (and the
   * caller-says-why flag) when either end is unmapped. */
  function estimateTravel(from, to) {
    if (!from || !to) return { miles: null, hours: null, mode: null, unmapped: true };
    const miles = haversineMiles(from, to);
    if (miles == null) return { miles: null, hours: null, mode: null, unmapped: true };
    const ground = miles < TRAVEL_MODEL.groundThresholdMiles;
    const hours = ground ? miles / TRAVEL_MODEL.groundMph
      : miles / TRAVEL_MODEL.cruiseMph + TRAVEL_MODEL.airportOverheadHours;
    return { miles: round(miles, 0), hours: round(hours, 1), mode: ground ? "ground (model)" : "air (model)", unmapped: false };
  }

  /* UTC offset in hours for an IANA zone at a given instant, from the runtime's tz database.
   * Returns null when the runtime cannot answer — never a hard-coded guess. */
  function utcOffsetHours(tz, iso) {
    if (!tz) return null;
    const d = iso ? new Date(iso) : new Date();
    if (isNaN(d)) return null;
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset", hour: "2-digit" })
        .formatToParts(d).find(p => p.type === "timeZoneName");
      const m = parts && parts.value && parts.value.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
      if (!m) return parts && parts.value === "GMT" ? 0 : null;
      const sign = m[1] === "-" ? -1 : 1;
      return sign * (Number(m[2]) + Number(m[3] || 0) / 60);
    } catch (e) { return null; }
  }

  /* Whole days of rest between two game dates: 0 means the next day (a back-to-back on the
   * schedule; NBA back-to-backs are consecutive calendar dates). */
  function restDaysBetween(prevIso, nextIso) {
    const a = new Date(prevIso), b = new Date(nextIso);
    if (isNaN(a) || isNaN(b)) return null;
    const dayA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
    const dayB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
    return Math.round((dayB - dayA) / 86400000) - 1;
  }

  return {
    MODEL_VERSION, tableDigest, CITIES, VENUE_CITY, TEAM_HOME_CITY, TRAVEL_MODEL,
    coordsFor, coordsForVenue, homeCoords, haversineMiles, estimateTravel, utcOffsetHours,
    restDaysBetween, foldCity, round
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Geo;
