/**
 * Leaflet's default marker icons reference images by relative path which
 * breaks under Vite. This helper re-imports the assets so they end up
 * bundled and reachable at runtime.
 *
 * Call once from any page/component that mounts <Marker> elements:
 *   import 'leaflet-icons';   // side-effect import
 * or, equivalently:
 *   import { fixLeafletIcons } from '../utils/leaflet-icons';
 *   fixLeafletIcons();
 */

import L from 'leaflet';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

let applied = false;

export function fixLeafletIcons() {
  if (applied) return;
  // @ts-expect-error — internal property used by react-leaflet & Leaflet itself
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl,
    iconUrl,
    shadowUrl,
  });
  applied = true;
}

// Run on import — pages that use <Marker> will get correct icons.
fixLeafletIcons();

export default fixLeafletIcons;