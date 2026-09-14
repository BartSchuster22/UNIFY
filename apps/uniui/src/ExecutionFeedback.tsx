import { Alert, Button, Group, Loader, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
export function ExecutionFeedback({ startedAt, uncertain, onChecked }: { startedAt: number; uncertain: boolean; onChecked: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (uncertain) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [uncertain, startedAt]);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return <Alert color={uncertain ? 'orange' : 'blue'} title={uncertain ? 'Request outcome unconfirmed' : 'Waiting for Hermes'}>
    <Stack gap="xs">
      <Group role="status">{!uncertain && <Loader size="sm" />}<Text>{uncertain
        ? 'The request may still be running or may have completed. Check conversation history before sending again.'
        : 'Your request is in progress. Waiting for the server response; individual tool progress is not streamed here. Do not resend.'}</Text></Group>
      {!uncertain && <Text size="sm" aria-live="off">Elapsed: {seconds}s. You can keep this page open while Hermes works.</Text>}
      {uncertain && <Button variant="light" onClick={onChecked}>I have checked the conversation history</Button>}
    </Stack>
  </Alert>;
}
