import { saveImageAs } from '../../lib/desktop';
import { pathBaseName } from '../../lib/localImage';
import { toast } from '../../lib/toast';

/** Offers to save the image a viewer is showing, named after its label. */
export async function downloadImage(src: string, label: string): Promise<void> {
  try {
    const result = await saveImageAs(src, pathBaseName(label));
    if (result.saved) toast.success(`Saved ${pathBaseName(result.filePath)}`);
  } catch {
    toast.error('Could not save the image');
  }
}
