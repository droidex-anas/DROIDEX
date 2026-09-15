import { motion, useReducedMotion } from 'framer-motion';
import { Scan, X } from 'lucide-react';
import type { CaptureMetadata } from './types';

export function CaptureAttachmentCard({
  preview,
  capture,
  onOpen,
  onRemove,
}: {
  preview: string;
  capture: CaptureMetadata;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      className="capture-attachment"
      initial={reducedMotion ? false : { opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      <button
        type="button"
        className="capture-attachment-open"
        onClick={onOpen}
        aria-label={`Edit screenshot: ${capture.title}`}
      >
        <img src={preview} alt={capture.title} />
        <span className="capture-attachment-title">
          <Scan size={14} />
          <span>{capture.title}</span>
        </span>
        <span className="capture-attachment-meta">
          {capture.width} × {capture.height} · PNG · Edit
        </span>
      </button>
      <button
        type="button"
        className="capture-attachment-remove"
        aria-label={`Remove ${capture.title}`}
        onClick={onRemove}
      >
        <X size={13} />
      </button>
    </motion.div>
  );
}
