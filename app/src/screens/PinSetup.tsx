import { useState } from 'react';
import { Text, View } from 'react-native';

import { Body, Title } from '../ui/components';
import { PinPad } from '../ui/PinPad';
import { font, space, useTheme } from '../ui/theme';

/** Choose a PIN, then type it again. */
export function PinSetup({
  title,
  subtitle,
  onDone,
  length = 6,
}: {
  title: string;
  subtitle: string;
  onDone: (pin: string) => void;
  length?: number;
}) {
  const t = useTheme();
  const [first, setFirst] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [shake, setShake] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const submit = (pin: string) => {
    if (first === null) {
      if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) {
        setError('Avoid repeated or sequential digits.');
        setShake((n) => n + 1);
        setValue('');
        return;
      }
      setFirst(pin);
      setValue('');
      setError(null);
      return;
    }
    if (pin !== first) {
      setError("PINs didn't match. Start again.");
      setShake((n) => n + 1);
      setFirst(null);
      setValue('');
      return;
    }
    onDone(pin);
  };

  return (
    <View style={{ alignItems: 'center', gap: space.md }}>
      <Title style={{ textAlign: 'center' }}>{first === null ? title : 'Type it again'}</Title>
      <Body muted style={{ textAlign: 'center', marginBottom: space.lg }}>
        {first === null ? subtitle : 'Confirm your PIN.'}
      </Body>
      <PinPad value={value} onChange={setValue} length={length} onSubmit={(p) => setTimeout(() => submit(p), 120)} shakeKey={shake} />
      <Text style={{ color: t.danger, fontSize: font.small, minHeight: 20, marginTop: space.md }}>{error ?? ''}</Text>
    </View>
  );
}
