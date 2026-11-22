import { useRef, useState } from 'react';
import { Trash, Upload } from '@droidex/icons';
import { Dropdown, GroupLabel, PreviewCard, SettingRow } from '../../components/settingsKit';
import { Switch } from '../../components/Switch';
import { Button } from '../../components/ui/Button';
import { DitherArt } from './DitherArt';
import { imageFileToDataUrl } from './imageUpload';
import {
  addSavedBackground,
  ART_PRESETS,
  MAX_SAVED_BACKGROUNDS,
  removeSavedBackground,
  updateNewChatLook,
  useNewChatLook,
  type ArtPreset,
  type LogoChoice,
  type SavedBackground,
} from './newChatLook';
import { useDraftHarness } from './useDraftHarness';
import type { ProviderKind } from '../../types/bridge';

const PRESET_LABELS: Record<ArtPreset, string> = {
  glow: 'Glow',
  rotor: 'Rotor',
  ridgeline: 'Ridgeline',
  contour: 'Contour',
};

const LOGO_OPTIONS: { value: LogoChoice; label: string }[] = [
  { value: 'harness', label: 'Harness logo' },
  { value: 'wordmark', label: 'DROIDEX wordmark' },
  { value: 'none', label: 'None' },
];

const BACKGROUND_MAX_SIDE = 1600;

function AddImageButton({ disabled, onFile }: { disabled: boolean; onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        size="sm"
        icon={Upload}
        disabled={disabled}
        title={
          disabled ? `Up to ${String(MAX_SAVED_BACKGROUNDS)} images. Remove one first.` : undefined
        }
        onClick={() => {
          inputRef.current?.click();
        }}
      >
        Add image
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

function SavedBackgroundTile({
  background,
  index,
  active,
  dither,
  harness,
  onError,
}: {
  background: SavedBackground;
  index: number;
  active: boolean;
  dither: boolean;
  harness: ProviderKind;
  onError: (message: string) => void;
}) {
  const label = `Image ${String(index + 1)}`;
  return (
    // The remove button sits beside the card, not in it: a button cannot hold another.
    <div className="group relative grid">
      <PreviewCard
        label={label}
        active={active}
        onClick={() => {
          try {
            updateNewChatLook({ backdrop: background.id });
          } catch {
            onError('Could not save that choice.');
          }
        }}
      >
        <div className="relative size-full bg-bg">
          {dither ? (
            <DitherArt
              source={{ kind: 'image', url: background.image }}
              provider={harness}
              cellPx={2}
            />
          ) : (
            <img src={background.image} alt="" className="size-full object-cover" />
          )}
        </div>
      </PreviewCard>
      <span className="absolute right-3 top-3 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Button
          variant="secondary"
          size="sm"
          shape="round"
          icon={Trash}
          aria-label={`Remove ${label}`}
          className="shadow-sm"
          onClick={() => {
            removeSavedBackground(background.id);
          }}
        />
      </span>
    </div>
  );
}

// Appearance card for what a new chat shows: the mark above the greeting and
// the artwork behind the composer, both lit by the selected harness.
export function NewChatLookSettings() {
  const look = useNewChatLook();
  const harness = useDraftHarness();
  const [error, setError] = useState<string | null>(null);
  const atLimit = look.savedBackgrounds.length >= MAX_SAVED_BACKGROUNDS;

  const choose = (patch: Parameters<typeof updateNewChatLook>[0]) => {
    try {
      updateNewChatLook(patch);
      setError(null);
    } catch {
      setError('Could not save that choice.');
    }
  };

  const addImage = (file: File) => {
    imageFileToDataUrl(file, BACKGROUND_MAX_SIDE, 'image/jpeg').then(
      (image) => {
        try {
          addSavedBackground(image);
          setError(null);
        } catch {
          setError('Not enough room to save that image. Remove a saved one and try again.');
        }
      },
      () => {
        setError('That file could not be read as an image.');
      },
    );
  };

  return (
    <>
      <GroupLabel>New chat</GroupLabel>
      <div className="mb-6 rounded-xl bg-surface shadow-lg">
        <SettingRow
          label="Logo"
          description="Shown above the greeting. The harness logo follows the harness you pick."
        >
          <Dropdown
            ariaLabel="Logo"
            value={look.logo}
            options={LOGO_OPTIONS}
            onChange={(value) => {
              const choice = LOGO_OPTIONS.find((option) => option.value === value);
              if (choice) choose({ logo: choice.value });
            }}
          />
        </SettingRow>

        <SettingRow
          label="Background"
          description="Shown behind the composer until the chat starts. Add your own images to keep them here."
        >
          <AddImageButton disabled={atLimit} onFile={addImage} />
        </SettingRow>

        <div className="grid grid-cols-3 gap-3 px-4 pb-4">
          <PreviewCard
            label="None"
            active={look.backdrop === 'none'}
            onClick={() => {
              choose({ backdrop: 'none' });
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
                choose({ backdrop: preset });
              }}
            >
              <div className="relative size-full bg-bg">
                <DitherArt source={{ kind: 'preset', preset }} provider={harness} cellPx={2} />
              </div>
            </PreviewCard>
          ))}
          {look.savedBackgrounds.map((background, index) => (
            <SavedBackgroundTile
              key={background.id}
              background={background}
              index={index}
              active={look.backdrop === background.id}
              dither={look.ditherImage}
              harness={harness}
              onError={setError}
            />
          ))}
        </div>

        {look.savedBackgrounds.length > 0 && (
          <SettingRow
            label="Dither your images"
            description="Redraw them as halftone dots in the harness color"
          >
            <Switch
              label="Dither your images"
              checked={look.ditherImage}
              onChange={(ditherImage) => {
                choose({ ditherImage });
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
