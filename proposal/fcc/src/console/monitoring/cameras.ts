import type { Camera } from './model';

export const CAMERAS: Camera[] = [
  { id: 'rafina-port', name: 'Rafina Port', provider: 'ForecastWeather / local hosts',
    url: 'https://www.forecastweather.gr/kameres/attikis/limani-rafinas.html',
    pos: { lon: 24.009, lat: 38.022 }, locationNote: 'Approximate port location, not a surveyed camera pose',
    note: 'Current waterfront camera. Player availability unverified; opens original provider.' },
  { id: 'nea-makri-port', name: 'Nea Makri harbour', provider: 'MeteoCam / Monaco Cafe Bar',
    url: 'https://www.meteocam.gr/neamakri', pos: { lon: 23.983130, lat: 38.087723 },
    locationNote: 'Coordinates published by provider',
    note: 'Current camera; provider counter begins March 2026. Not a 2018 camera archive.' },
  { id: 'schinias-fire', name: 'Schinias Fire Cam', provider: 'MeteoCam',
    url: 'https://www.meteocam.gr/SchiniasFireCam', locationNote: 'Schinias / Marathon area; exact camera coordinates not verified',
    note: 'Provider includes 23 July 2018 weather context. Historical video availability not established.' },
  { id: 'marathon-park', name: 'Marathon Park', provider: 'MeteoCam',
    url: 'https://www.meteocam.gr/MarathonPark', locationNote: 'Provider describes a location south of Schinias Fire Cam; no verified point',
    note: 'Current park camera and rolling timelapse, not an incident-date archive.' },
  { id: 'schinias-moraitis', name: 'Schinias · Moraitis beach', provider: 'MeteoCam',
    url: 'https://www.meteocam.gr/SchiniasMoraitis', pos: { lon: 24.016279, lat: 38.135060 },
    locationNote: 'Coordinates published by provider',
    note: 'Provider reports streaming since 2014. No July 2018 footage archive verified.' },
  { id: 'penteli-observatory', name: 'Penteli Observatory', provider: 'National Observatory of Athens / meteo.gr',
    url: 'https://www.meteo.gr/camerasmain.cfm', pos: { lon: 23.864, lat: 38.048 },
    locationNote: 'Approximate observatory location; views toward Hymettus, southwest and Penteli',
    note: 'Current panorama / hourly images. Reproduction requires permission.' },
  { id: 'athens-acropolis', name: 'Athens · Acropolis context', provider: 'earthTV / COCO-MAT Hotel Athens',
    url: 'https://www.earthtv.com/en/webcam/athens-acropolis', locationNote: 'Wider Athens context, not Mati coverage',
    note: 'Current city view. Opens provider; no recording or embed permission verified.' },
];

export const HISTORICAL_MEDIA = [
  { title: 'Daou / Penteli ignition CCTV report', date: '2018-07-23 · reported 16:41 EEST',
    url: 'https://www.ekathimerini.com/news/231880/video-footage-shows-minutes-mati-fire-broke-out/',
    note: 'Kathimerini, published 21 August 2018. Article link only; clip reuse rights and full visual review unresolved.' },
  { title: 'Mati spread CCTV report', date: '2018-07-23 · reported 18:07 EEST',
    url: 'https://www.ekathimerini.com/news/232702/camera-footage-shows-speed-of-fire-spreading-in-mati/',
    note: 'Kathimerini / SKAI, published 18 September 2018. Article link only, not copied footage.' },
];
