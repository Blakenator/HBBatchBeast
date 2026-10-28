import React from 'react';
import { toast } from 'react-toastify';
import { PROMISE_CHANNEL } from '../../common';
import { useBackend } from '../helpers';
import { IconButton } from './Button';

interface OpenFolderButtonProps {
  path: string;
  label: string;
  title?: string;
  failureMessage: string;
}

/** Opens a configured media folder in the OS file manager. */
export const OpenFolderButton: React.FC<OpenFolderButtonProps> = ({
  path,
  label,
  title,
  failureMessage,
}) => {
  const openFolder = useBackend({
    channel: PROMISE_CHANNEL.OpenFolder,
    skip: true,
  });

  const open = async () => {
    try {
      const result = await openFolder.refetch({ path });
      if (!result || result.error) {
        const detail = result?.error?.message;
        toast.error(detail ? `${failureMessage}: ${detail}` : failureMessage);
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? `${failureMessage}: ${error.message}`
          : failureMessage,
      );
    }
  };

  return (
    <IconButton
      icon="openExternal"
      label={title ?? label}
      onClick={() => void open()}
      disabled={path.trim().length === 0 || openFolder.loading}
    />
  );
};
