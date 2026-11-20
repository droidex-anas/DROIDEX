import { useRef, useState } from 'react';
import { Trash, Upload } from '@droidex/icons';
import { Dropdown, GroupLabel, PreviewCard, SettingRow } from '../../components/settingsKit';
import { Switch } from '../../components/Switch';
import { Button } from '../../components/ui/Button';
import { DitherArt } from './DitherArt';
import { imageFileToDataUrl } from './imageUpload';
import {
  ART_PRESETS,
  updateNewChatLook,
  useNewChatLook,
  type ArtPreset,
  type LogoChoice,
  type NewChatLook,
} from './newChatLook';
import { useDraftHarness } from './useDraftHarness';

const PRESET_LABELS: Record<ArtPreset, string> = {
  glow: 'Glow',
  rotor: 'Rotor',
  ridgeline: 'Ridgeline',
  contour: 'Contour',
};

const BACKGROUND_MAX_SIDE = 1920;
const LOGO_MAX_SIDE = 256;

function UploadButton({ label, onFile }: { label: string; onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        size="sm"
        icon={Upload}
        onClick={() => {
          inputRef.current?.click();
        }}
      >
        {label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so picking the same file again still fires a change.
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
    </>
  );
}

// Appearance card for what a new chat shows: the mark above the greeting and
// the artwork behind the composer, both lit by the selected harness.
export function NewChatLookSettings() {
  const look = useNewChatLook();
  const harness = useDraftHarness();
  const [error, setError] = useState<string | null>(null);

  const apply = (patch: Partial<NewChatLook>) => {
    try {
      updateNewChatLook(patch);
      setError(null);
    } catch {
      setError('Could not save that image. Try a smaller one.');
    }
  };

  const upload = (
    file: File,
    maxSide: number,
    type: 'image/jpeg' | 'image/png',
    toPatch: (image: string) => Partial<NewChatLook>,
  ) => {
    imageFileToDataUrl(file, maxSide, type).then(
      (image) => {
        apply(toPatch(image));
      },
      () => {
        setError('That file could not be read as an image.');
      },
    );
  };

  const logoOptions: { value: LogoChoice; label: string }[] = [
    { value: 'harness', label: 'Harness logo' },
    { value: 'wordmark', label: 'DROIDEX wordmark' },
    ...(look.logoImage ? [{ value: 'custom' as const, label: 'Uploaded logo' }] : []),
    { value: 'none', label: 'None' },
  ];

  return (
    <>
      <GroupLabel>New chat</GroupLabel>
      <div className="mb-6 rounded-xl bg-surface shadow-lg">
        <SettingRow
          label="Logo"
          description="Shown above the greeting. The harness logo follows the harness you pick."
        >
          <div className="flex shrink-0 items-center gap-2">
            {look.logoImage && (
              <Button
                variant="ghost"
                size="sm"
                icon={Trash}
                aria-label="Remove uploaded logo"
                onClick={() => {
                  apply({ logoImage: null });
                }}
              />
            )}
            <UploadButton
              label="Upload"
              onFile={(file) => {
                upload(file, LOGO_MAX_SIDE, 'image/png', (logoImage) => ({
                  logoImage,
                  logo: 'custom',
                }));
              }}
            />
            <Dropdown
              ariaLabel="Logo"
              value={look.logo}
              options={logoOptions}
              onChange={(value) => {
                const choice = logoOptions.find((option) => option.value === value);
                if (choice) apply({ logo: choice.value });
              }}
            />
          </div>
        </SettingRow>

        <SettingRow
          label="Background"
          description="Shown behind the composer until the chat starts, lit in the harness color."
        >
          <div className="flex shrink-0 items-center gap-2">
            {look.backgroundImage && (
              <Button
                variant="ghost"
                size="sm"
                icon={Trash}
                aria-label="Remove uploaded background"
                onClick={() => {
                  apply({ backgroundImage: null });
                }}
              />
            )}
            <UploadButton
              label="Upload image"
              onFile={(file) => {
                upload(file, BACKGROUND_MAX_SIDE, 'image/jpeg', (backgroundImage) => ({
                  backgroundImage,
                  backdrop: 'custom',
                }));
              }}
            />
          </div>
        </SettingRow>

        <div className="grid grid-cols-3 gap-3 px-4 pb-4">
          <PreviewCard
            label="None"
            active={look.backdrop === 'none'}
            onClick={() => {
              apply({ backdrop: 'none' });
            }}
          >
            <div className="size-full bg-bg" />
          </PreviewCard>
          {ART_PRESETS.map((preset) => (
            <PreviewCard
              key={preset}
              label={PRESET_LABELS[preset]}
              active={look.backdrop === preset}
              onClick={() => {
                apply({ backdrop: preset });
              }}
            >
              <div className="relative size-full bg-bg">
                <DitherArt source={{ kind: 'preset', preset }} provider={harness} cellPx={2} />
              </div>
            </PreviewCard>
          ))}
          {look.backgroundImage && (
            <PreviewCard
              label="Uploaded"
              active={look.backdrop === 'custom'}
              onClick={() => {
                apply({ backdrop: 'custom' });
              }}
            >
              <div className="relative size-full bg-bg">
                {look.ditherImage ? (
                  <DitherArt
                    source={{ kind: 'image', url: look.backgroundImage }}
                    provider={harness}
                    cellPx={2}
                  />
                ) : (
                  <img src={look.backgroundImage} alt="" className="size-full object-cover" />
                )}
              </div>
            </PreviewCard>
          )}
        </div>

        {look.backgroundImage && (
          <SettingRow
            label="Dither uploaded image"
            description="Redraw it as halftone dots in the harness color"
          >
            <Switch
              label="Dither uploaded image"
              checked={look.ditherImage}
              onChange={(ditherImage) => {
                apply({ ditherImage });
              }}
            />
          </SettingRow>
        )}

        {error && (
          <p role="alert" className="px-4 pb-4 text-caption text-danger">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
