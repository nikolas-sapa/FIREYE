export const LAB_SAMPLES = [
  {
    id: 'forest', name: 'Forest canopy', path: '/image-lab/forest.jpg',
    credit: 'Geran de Klerk · CC0', source: 'https://commons.wikimedia.org/wiki/File:Drone_Forest_(Unsplash).jpg',
    check: 'Canopy and shadow. Does the model invent understory or label every tree high-risk?',
  },
  {
    id: 'village', name: 'Vegetation + buildings', path: '/image-lab/village.jpg',
    credit: 'U.S. Fish and Wildlife Service · Public domain', source: 'https://commons.wikimedia.org/wiki/File:Aerial_view_of_small_village.jpg',
    check: 'Aerial settlement view. Check structure contact and small-object uncertainty.',
  },
  {
    id: 'quarry', name: 'Material-pile challenge', path: '/image-lab/quarry.jpg',
    credit: 'Mariusz Prusaczyk · CC0', source: 'https://commons.wikimedia.org/wiki/File:The_surface_mine_storage_place._(Unsplash).jpg',
    check: 'Mine storage piles. Does it guess material contents or confuse brown surfaces with dry vegetation?',
  },
] as const;
