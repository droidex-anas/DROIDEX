import type { DesignReference } from '@droidex/protocol';
import type { AttachedImage } from '../../hooks/useImageAttachments';
import type { AttachedFile } from '../../hooks/useFileAttachments';
import { imageSrc } from '../../lib/localImage';
import { DesignMarkChip } from './DesignMarkChip';
import { CanvasImageChip } from './CanvasImageChip';
import { ImageChip } from './ImageChip';
import { FileChip } from './FileChip';
import type { CanvasImageReference } from './useCanvasImageReferences';

interface ComposerAttachmentsProps {
  designMarks: readonly DesignReference[];
  images: readonly AttachedImage[];
  files: readonly AttachedFile[];
  attachedImagePaths: readonly string[];
  attachedDocumentPaths: readonly string[];
  canvasReferenceOf: (sequence: number) => CanvasImageReference | undefined;
  onInsertMark: (mark: DesignReference) => void;
  onRemoveMark: (mark: DesignReference) => void;
  onOpenImage: (image: AttachedImage) => void;
  onRemoveImage: (image: AttachedImage) => void;
  onRemoveFile: (id: string) => void;
  onOpenPath: (path: string) => void;
  onRemovePath: (path: string) => void;
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

export function ComposerAttachments({
  designMarks,
  images,
  files,
  attachedImagePaths,
  attachedDocumentPaths,
  canvasReferenceOf,
  onInsertMark,
  onRemoveMark,
  onOpenImage,
  onRemoveImage,
  onRemoveFile,
  onOpenPath,
  onRemovePath,
}: ComposerAttachmentsProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3">
      {designMarks.map((mark) => (
        <DesignMarkChip
          key={mark.id}
          mark={mark}
          onInsert={() => {
            onInsertMark(mark);
          }}
          onRemove={() => {
            onRemoveMark(mark);
          }}
        />
      ))}
      {images.map((img) => {
        const reference = canvasReferenceOf(img.sequence);
        const open = () => {
          onOpenImage(img);
        };
        const remove = () => {
          onRemoveImage(img);
        };
        return reference ? (
          <CanvasImageChip
            key={img.id}
            src={img.preview}
            reference={reference}
            onOpen={open}
            onRemove={remove}
          />
        ) : (
          <ImageChip
            key={img.id}
            src={img.preview}
            label={basename(img.path)}
            onOpen={open}
            onRemove={remove}
          />
        );
      })}
      {files.map((file) => (
        <FileChip
          key={file.id}
          path={file.path}
          name={file.name}
          onRemove={() => {
            onRemoveFile(file.id);
          }}
        />
      ))}
      {attachedImagePaths.map((path) => {
        const src = imageSrc(path);
        const remove = () => {
          onRemovePath(path);
        };
        return src === null ? (
          <FileChip key={path} path={path} onRemove={remove} />
        ) : (
          <ImageChip
            key={path}
            src={src}
            label={basename(path)}
            onOpen={() => {
              onOpenPath(path);
            }}
            onRemove={remove}
          />
        );
      })}
      {attachedDocumentPaths.map((f) => (
        <FileChip
          key={f}
          path={f}
          onRemove={() => {
            onRemovePath(f);
          }}
        />
      ))}
    </div>
  );
}
