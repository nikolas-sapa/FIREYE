/**
 * Documented timeline of the 23 July 2018 Mati / NE Attica fire, used by fetch-mati.mjs.
 * Times are EEST (UTC+3) as published. Summaries are short paraphrases with attribution;
 * no victim identities, addresses or casualty details beyond published aggregate figures.
 */
const eest = (s) => Date.parse(s.replace(' ', 'T') + ':00+03:00');

export const SRC = {
  iawf: { name: 'IAWF Wildfire Magazine, "Fire around the globe: Attica region, Greece, July 2018"', url: 'https://www.iawfonline.org/article/fire-globe-attica-region-greece-july-2018/' },
  firelinks: { name: 'Xanthopoulos & Mitsopoulos, "The catastrophic fire of July 2018 in Greece" (FIRElinks)', url: 'https://firelinks.eu/wp-content/uploads/2019/11/Xanthopoulos-Mitsopoulos-The-catastrophic-fire-of-July-2018-in-Greece-for-Firelinks-site.pdf' },
  thetoc: { name: "thetoc.gr, timeline from the prosecutor's report", url: 'https://www.thetoc.gr/koinwnia/article/mati-to-xronologio-tou-tromou-sto-eisaggeliko-porisma/' },
  kathimerini: { name: "Kathimerini, prosecutor's report coverage (Oct 2021)", url: 'https://www.kathimerini.gr/society/561536221/to-eisaggeliko-porisma-gia-to-mati-ta-egklimatika-lathi-kai-oi-olethrioi-cheirismoi/' },
  cretalive: { name: "cretalive.gr, prosecutor's report coverage", url: 'https://www.cretalive.gr/ellada/porisma-kolafos-gia-mati-ypirhe-hronos-gia-ekkenosi-me-aneto-badisma' },
  bams: { name: 'Lagouvardos et al. 2019, BAMS, "The meteorological conditions of the 2018 Attica fires"', url: 'https://doi.org/10.1175/BAMS-D-18-0231.1' },
  guardian: { name: 'The Guardian, "Greek fires one year on" (20 Jul 2019)', url: 'https://www.theguardian.com/world/2019/jul/20/greek-fires-one-year-on-103-dead-survivors-and-rescuers-look-back' },
  wikipedia: { name: 'Wikipedia, "2018 Attica wildfires"', url: 'https://en.wikipedia.org/wiki/2018_Attica_wildfires' },
  effis: { name: 'EFFIS burnt area, feature 15060', url: 'https://maps.effis.emergency.copernicus.eu/effis?service=WFS&version=1.1.0&request=GetFeature&typeName=ms:modis.ba.poly&bbox=37.98,23.85,38.10,24.08,EPSG:4326&outputFormat=geojson' },
  toi: { name: 'Times of Israel (AP), 24 Jul 2018', url: 'https://www.timesofisrael.com/death-toll-in-greece-wildfires-rises-to-60/' },
  wikiRescue: { name: 'Wikipedia, "2018 Attica wildfires"', url: 'https://en.wikipedia.org/wiki/2018_Attica_wildfires' },
  ekath112: { name: 'ekathimerini, "Greece activates full service of European emergency number" (1 Jan 2020)', url: 'https://www.ekathimerini.com/news/248021/greece-activates-full-service-of-european-emergency-number/' },
  ekathCam: { name: 'ekathimerini, "Camera footage shows speed of fire spreading in Mati"', url: 'https://www.ekathimerini.com/news/232702/camera-footage-shows-speed-of-fire-spreading-in-mati/' },
};

export const IGNITION_ALTERNATIVES = [
  { t: eest('2018-07-23 16:41'), label: '199 call / first announcement', source: `${SRC.iawf.name}; ${SRC.kathimerini.name}`, url: SRC.kathimerini.url, used: true },
  { t: eest('2018-07-23 16:35'), label: "Prosecutor's estimate of the real start", source: SRC.thetoc.name, url: SRC.thetoc.url },
  { t: Date.UTC(2018, 6, 23, 13, 50), label: 'BAMS text: 1350 UTC (1355 UTC elsewhere in the paper)', source: SRC.bams.name, url: SRC.bams.url },
  { t: eest('2018-07-23 16:57'), label: 'Fire Service press release time', source: SRC.wikipedia.name, url: SRC.wikipedia.url },
];

/** placeId resolves to the manifest place position at build time. */
export const CHECKPOINTS = [
  { id: 'ignition', t: eest('2018-07-23 16:41'), label: 'Fire reported in Daou Penteli (199 call)', placeId: 'ignition', radiusM: 300, source: `${SRC.iawf.name}; ${SRC.kathimerini.name}`, url: SRC.iawf.url, uncertaintyMin: 6 },
  { id: 'first-house', t: eest('2018-07-23 16:46'), label: 'Perimeter about 400 m; first house burning about 150 m from the origin', placeId: 'ignition', radiusM: 300, source: `${SRC.iawf.name}; ${SRC.firelinks.name}`, url: SRC.iawf.url, uncertaintyMin: 5, perimeterM: 400 },
  { id: 'two-fingers', t: eest('2018-07-23 17:21'), label: 'Perimeter over 3,500 m; two fingers heading SE and E', source: `${SRC.iawf.name}; ${SRC.thetoc.name} (17:17-17:30 split into flank fingers)`, url: SRC.iawf.url, uncertaintyMin: 10, perimeterM: 3500 },
  { id: 'nv-west-edge', t: eest('2018-07-23 17:41'), label: 'Perimeter at least 6,000 m; fire at the west edge of Neos Voutzas', pos: { lon: 23.975, lat: 38.042 }, radiusM: 400, source: SRC.iawf.name, url: SRC.iawf.url, uncertaintyMin: 10, perimeterM: 6000 },
  { id: 'neos-voutzas', t: eest('2018-07-23 18:02'), label: 'Fire burns Neos Voutzas', placeId: 'neos-voutzas', radiusM: 400, source: SRC.thetoc.name, url: SRC.thetoc.url, uncertaintyMin: 10 },
  { id: 'marathonos', t: eest('2018-07-23 18:19'), label: 'Front crosses Marathonos Ave at several points toward Mati and Kokkino Limanaki', placeId: 'marathonos-crossing', radiusM: 500, source: `${SRC.firelinks.name} (~18:18); ${SRC.kathimerini.name} (~18:20)`, url: SRC.firelinks.url, uncertaintyMin: 10 },
  { id: 'analipsi', t: eest('2018-07-23 18:44'), label: 'Front past Marathonos reaches the Rafina junction at the Analipsi church (Kokkino Limanaki side)', placeId: 'analipsi-church', radiusM: 500, source: SRC.thetoc.name, url: SRC.thetoc.url, uncertaintyMin: 10 },
  { id: 'coast-mati', t: eest('2018-07-23 18:45'), label: 'Fire reaches the coastline in Mati (Poseidonos Ave)', placeId: 'mati-coast', radiusM: 500, source: `${SRC.thetoc.name}; IAWF: head reached the sea in under 2 h; cretalive: "around 19:00"`, url: SRC.thetoc.url, uncertaintyMin: 15 },
];

const logVia = (outlet) => `Fire Service operations log, per the prosecutor's report (via ${outlet})`;

export const REPORTS = [
  { id: 'r-1641-199', t: eest('2018-07-23 16:41'), kind: 'agency', publisher: logVia('Kathimerini'), summary: 'Fire reported to the 199 line in Daou, Penteli.', url: SRC.kathimerini.url, lang: 'el' },
  { id: 'r-1650-heli', t: eest('2018-07-23 16:50'), kind: 'agency', publisher: logVia('thetoc.gr'), summary: 'The only available helicopter starts water drops; it works the fire until 18:20.', url: SRC.thetoc.url, lang: 'el' },
  { id: 'r-1652-engines', t: eest('2018-07-23 16:52'), kind: 'agency', publisher: logVia('cretalive.gr'), summary: 'First fire engines logged at Daou between 16:52 and 16:56.', url: SRC.cretalive.url, lang: 'el' },
  { id: 'r-1710-s64', t: eest('2018-07-23 17:10'), kind: 'agency', publisher: logVia('cretalive.gr'), summary: 'S-64 helicopter crew reports fire around houses at Daou.', url: SRC.cretalive.url, lang: 'el' },
  { id: 'r-1730-s64', t: eest('2018-07-23 17:30'), kind: 'agency', publisher: logVia('cretalive.gr'), summary: 'Same helicopter: fire near houses, moving east, will threaten more houses.', url: SRC.cretalive.url, lang: 'el' },
  { id: 'r-1730-alert', t: eest('2018-07-23 17:30'), kind: 'official', publisher: "Prosecutor's report (via Kathimerini)", summary: 'General alert of forces ordered; the prosecutor assesses it as about one hour late.', url: SRC.kathimerini.url, lang: 'el' },
  { id: 'r-1730-ferries', t: eest('2018-07-23 17:30'), kind: 'official', publisher: "Prosecutor's report (via Kathimerini)", summary: 'Ferries arriving at Rafina port from 17:30 were not diverted.', url: SRC.kathimerini.url, lang: 'el' },
  { id: 'r-1800-divert', t: eest('2018-07-23 18:00'), kind: 'agency', publisher: logVia('cretalive.gr'), summary: 'Helicopter diverted to a separate fire at Kalamaki / Motor Oil installations.', url: SRC.cretalive.url, lang: 'el' },
  { id: 'r-1810-evac', t: eest('2018-07-23 18:10'), kind: 'agency', publisher: logVia('thetoc.gr'), summary: 'Fire Service asks the mayor of Rafina to evacuate.', url: SRC.thetoc.url, lang: 'el' },
  { id: 'r-1813-call', t: eest('2018-07-23 18:13'), kind: 'agency', publisher: "199 call record, per the prosecutor's report (via Kathimerini)", summary: 'Caller in Neos Voutzas reports fire burning all around them.', url: SRC.kathimerini.url, lang: 'el' },
  { id: 'r-1820-noair', t: eest('2018-07-23 18:20'), kind: 'agency', publisher: logVia('thetoc.gr'), summary: 'No aircraft operating over the fire between 18:20 and 18:45.', url: SRC.thetoc.url, lang: 'el' },
  { id: 'r-1844-engine', t: eest('2018-07-23 18:44'), kind: 'agency', publisher: logVia('Kathimerini'), summary: 'First fire engine on Marathonos Ave at Agia Varvara.', url: SRC.kathimerini.url, lang: 'el' },
  { id: 'r-1850-coastguard', t: eest('2018-07-23 18:50'), kind: 'agency', publisher: "Prosecutor's report (via cretalive.gr)", summary: 'Coast Guard notified only after people had already sought refuge in the sea.', url: SRC.cretalive.url, lang: 'el' },
  { id: 'r-1917-agia-varvara', t: eest('2018-07-23 19:17'), kind: 'agency', publisher: logVia('thetoc.gr'), summary: 'Fire logged at Agia Varvara, Rafina (log time, not first arrival).', url: SRC.thetoc.url, lang: 'el', pos: { lon: 23.98238, lat: 38.02735 } },
  { id: 'r-1900-civprot', t: eest('2018-07-23 19:00'), kind: 'official', publisher: "Prosecutor's report (via thetoc.gr)", summary: 'Regional civil-protection coordinating body is called.', url: SRC.thetoc.url, lang: 'el' },
  { id: 'r-1909-engine', t: eest('2018-07-23 19:09'), kind: 'agency', publisher: logVia('Kathimerini'), summary: 'Second fire engine reaches Marathonos Ave at Fleming St.', url: SRC.kathimerini.url, lang: 'el' },
  { id: 'r-1911-cl415', t: eest('2018-07-23 19:11'), kind: 'agency', publisher: logVia('cretalive.gr'), summary: 'CL-415 crew reports one large front with 10-20 m flames heading to the sea.', url: SRC.cretalive.url, lang: 'el' },
  { id: 'r-1923-112', t: eest('2018-07-23 19:23'), kind: 'agency', publisher: "112 call record, per the prosecutor's report (via cretalive.gr)", summary: 'About 100 people have taken refuge in the sea at Argyra Akti, next to Kokkino Limanaki.', url: SRC.cretalive.url, lang: 'el', pos: { lon: 23.997, lat: 38.04 } },
  { id: 'r-2330-over', t: eest('2018-07-23 23:30'), kind: 'agency', publisher: logVia('thetoc.gr'), summary: 'Duty officer reports the fire phenomenon is over.', url: SRC.thetoc.url, lang: 'el' },
];

export const FACTS = [
  { id: 'area-effis', label: 'Burnt area (EFFIS satellite mapping)', value: '1,362 ha', source: SRC.effis.name, url: SRC.effis.url },
  { id: 'area-iawf', label: 'Burnt area (IAWF, FIRElinks)', value: '1,431 ha', source: `${SRC.iawf.name}; ${SRC.firelinks.name}`, url: SRC.iawf.url },
  { id: 'area-bams', label: 'Burnt area (BAMS, citing Lekkas et al.)', value: '1,250 ha', source: SRC.bams.name, url: SRC.bams.url },
  { id: 'deaths-wikipedia', label: 'Fatalities (final count, Oct 2022)', value: '104', source: SRC.wikipedia.name, url: SRC.wikipedia.url },
  { id: 'deaths-guardian', label: 'Fatalities (July 2019)', value: '103', source: SRC.guardian.name, url: SRC.guardian.url },
  { id: 'deaths-firelinks', label: 'Fatalities (2019 papers)', value: '102', source: `${SRC.firelinks.name}; ${SRC.bams.name}`, url: SRC.firelinks.url },
  { id: 'deaths-iawf', label: 'Fatalities (IAWF report)', value: '100', source: SRC.iawf.name, url: SRC.iawf.url },
  { id: 'injured', label: 'Injured', value: 'At least 150 seriously injured (FIRElinks); 172 (Wikipedia)', source: `${SRC.firelinks.name}; ${SRC.wikipedia.name}`, url: SRC.firelinks.url },
  { id: 'structures', label: 'Homes / structures', value: 'More than 1,650 homes (IAWF); about 3,000 houses (BAMS); more than 4,000 structures destroyed or damaged (Wikipedia)', source: `${SRC.iawf.name}; ${SRC.bams.name}; ${SRC.wikipedia.name}`, url: SRC.iawf.url },
  { id: 'vehicles', label: 'Vehicles burned', value: '305', source: SRC.bams.name, url: SRC.bams.url },
  { id: 'evacuated-sea', label: 'People evacuated from beaches by boat', value: '715 (navy vessels, yachts and fishing boats; government spokesman, 24 Jul)', source: SRC.toi.name, url: SRC.toi.url },
  { id: 'rescued', label: 'People evacuated or rescued', value: 'Over 700', source: SRC.wikiRescue.name, url: SRC.wikiRescue.url },
  { id: 'warning', label: 'Warning to residents', value: 'No warning or organized evacuation reached residents (IAWF). Cell-broadcast 112 alerts started in Greece only in 2020; in 2018 112 was a call line.', source: `${SRC.iawf.name}; ${SRC.ekath112.name}`, url: SRC.ekath112.url },
  { id: 'duration', label: 'Ignition to the sea', value: 'Under 2 hours; mean head rate of spread about 2.6 km/h, about 4 km/h through Mati with bursts over 5 km/h', source: SRC.iawf.name, url: SRC.iawf.url },
  { id: 'wind-penteli', label: 'Wind at Penteli (NOA station, 495 m)', value: 'WNW 32-56 km/h, gusts 50-89 km/h; gusts to 25-26 m/s with a lull 1440-1520 UTC', source: `${SRC.iawf.name}; ${SRC.bams.name}`, url: SRC.bams.url },
  { id: 'wind-rafina', label: 'Rafina weather', value: '38 C and 17% RH at 16:45 (HNMS); max 39 C, min RH 19% (BAMS); gusts occasionally to 120 km/h (FIRElinks)', source: `${SRC.iawf.name}; ${SRC.bams.name}; ${SRC.firelinks.name}`, url: SRC.iawf.url },
  { id: 'aircraft-gap', label: 'Aerial support', value: 'One helicopter dropped water 16:50-18:20; no aircraft 18:20-18:45', source: SRC.thetoc.name, url: SRC.thetoc.url },
  { id: 'camera', label: 'Camera evidence', value: 'Security-camera footage shows fire spreading in Mati from 18:07', source: SRC.ekathCam.name, url: SRC.ekathCam.url },
];
