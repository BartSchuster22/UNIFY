import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Card, Loader, Modal, Stack, Text, TextInput } from '@mantine/core';
import { api } from './api';
import { setDisplayTimezone } from './userTime';

type Preferences = { timezone: string | null };
const Context = createContext<{
  timezone: string | null;
  save: (value: string) => Promise<void>;
} | null>(null);
export function detectedTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
export function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    api<Preferences>('/auth/preferences')
      .then((result) => {
        if (!active) return;
        setDisplayTimezone(result.timezone ?? detectedTimezone());
        setPreferences(result);
      })
      .catch(() => {
        if (active) setError('Could not load your timezone preference. Please retry.');
      });
    return () => {
      active = false;
      setDisplayTimezone(undefined);
    };
  }, [attempt]);
  const save = async (timezone: string) => {
    const result = await api<Preferences>('/auth/preferences', {
      method: 'PUT',
      body: JSON.stringify({ timezone }),
    });
    setDisplayTimezone(result.timezone ?? detectedTimezone());
    setPreferences(result);
  };
  if (error)
    return (
      <Alert color="red">
        {error}
        <Button onClick={() => setAttempt((x) => x + 1)}>Retry preferences</Button>
      </Alert>
    );
  if (!preferences) return <Loader aria-label="Loading user preferences" />;
  return (
    <Context.Provider value={{ timezone: preferences.timezone, save }}>
      <Modal
        opened={!preferences.timezone}
        onClose={() => {}}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        title="Confirm your timezone"
      >
        <Text mb="md">
          Complete your account setup. We suggested your browser timezone; confirm it or choose
          another. You can change it later in Settings.
        </Text>
        <TimezoneEditor initial={detectedTimezone()} />
      </Modal>
      <Fragment key={preferences.timezone ?? 'unconfirmed'}>{children}</Fragment>
    </Context.Provider>
  );
}
function TimezoneEditor({ initial }: { initial: string }) {
  const preferences = useContext(Context);
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const supported =
    (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.(
      'timeZone',
    ) ?? [];
  const choices = [...new Set([initial, 'UTC', 'Atlantic/Canary', ...supported])].sort();
  return (
    <Stack>
      <TextInput
        label="Timezone"
        description="Named timezone, for example Atlantic/Canary. Daylight-saving changes are automatic."
        list="user-timezone-choices"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
      />
      <datalist id="user-timezone-choices">
        {choices.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      {error && <Alert color="red">{error}</Alert>}
      <Button
        loading={saving}
        disabled={!value.trim() || !preferences}
        onClick={() => {
          setSaving(true);
          setError('');
          void preferences
            ?.save(value.trim())
            .catch(() => setError('Could not save. Choose a valid named timezone and try again.'))
            .finally(() => setSaving(false));
        }}
      >
        Save timezone
      </Button>
    </Stack>
  );
}
export function UserTimezoneSettings() {
  const preferences = useContext(Context);
  if (!preferences) return null;
  return (
    <Card withBorder mb="md">
      <Text fw={700} mb="sm">
        Date & time
      </Text>
      <Text size="sm" mb="md">
        Your timezone is saved to your account and used across the UI. Original timestamps remain in
        UTC.
      </Text>
      <TimezoneEditor initial={preferences.timezone ?? detectedTimezone()} />
    </Card>
  );
}
