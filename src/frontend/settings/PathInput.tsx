import React from 'react';
import { Form } from 'react-bootstrap';
import { toast } from 'react-toastify';
import { PROMISE_CHANNEL, PathPickerKind } from '../../common';
import { useBackend } from '../helpers';
import { Button } from '../ui/Button';

interface BrowseButtonProps {
  kind: PathPickerKind;
  multiple?: boolean;
  title?: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
  onPick: (paths: string[]) => void;
  label?: string;
}

/** Opens the OS picker and reports the selected paths. */
export const BrowseButton: React.FC<BrowseButtonProps> = ({
  kind,
  multiple,
  title,
  defaultPath,
  filters,
  onPick,
  label = 'Browse…',
}) => {
  const picker = useBackend({
    channel: PROMISE_CHANNEL.PickPath,
    skip: true,
  });

  const browse = async () => {
    const result = await picker.refetch({
      kind,
      multiple,
      title,
      defaultPath: defaultPath || undefined,
      filters,
    });
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    const paths = result.data?.paths ?? [];
    if (!result.data?.canceled && paths.length > 0) onPick(paths);
  };

  return (
    <Button
      compact
      variant="ghost"
      onClick={() => void browse()}
      disabled={picker.loading}
      aria-label={title ?? label}
      title={title ?? label}
    >
      {label}
    </Button>
  );
};

interface PathInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  kind: PathPickerKind;
  title: string;
  placeholder?: string;
  filters?: { name: string; extensions: string[] }[];
  allowClear?: boolean;
  describedBy?: string;
}

/** Single path field with an OS picker and an optional clear action. */
export const PathInput: React.FC<PathInputProps> = ({
  id,
  value,
  onChange,
  kind,
  title,
  placeholder,
  filters,
  allowClear,
  describedBy,
}) => (
  <div style={{ display: 'flex', gap: 'var(--hb-space-xs)' }}>
    <Form.Control
      id={id}
      value={value}
      placeholder={placeholder}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value)}
    />
    <BrowseButton
      kind={kind}
      title={title}
      defaultPath={value}
      filters={filters}
      onPick={(paths) => onChange(paths[0] ?? '')}
    />
    {allowClear && value.length > 0 && (
      <Button
        compact
        variant="ghost"
        onClick={() => onChange('')}
        aria-label="Clear path"
        title="Clear path"
      >
        ×
      </Button>
    )}
  </div>
);
