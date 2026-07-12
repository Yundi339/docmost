import { Section, Text } from 'react-email';
import * as React from 'react';
import { content, paragraph } from '../css/styles';
import { MailBody } from '../partials/partials';

interface Props {
  username?: string;
  action: 'added' | 'removed';
  passkeyName: string;
  occurredAt: string;
  ipAddress?: string;
  device?: string;
}

export const PasskeyChangedEmail = ({
  username,
  action,
  passkeyName,
  occurredAt,
  ipAddress,
  device,
}: Props) => {
  return (
    <MailBody>
      <Section style={content}>
        <Text style={paragraph}>Hi {username || 'there'},</Text>
        <Text style={paragraph}>
          A passkey named <strong>{passkeyName}</strong> was {action} on your
          Docmost account.
        </Text>
        <Text style={paragraph}>
          Time: {occurredAt}
          <br />
          IP address: {ipAddress || 'Unavailable'}
          <br />
          Device: {device || 'Unavailable'}
        </Text>
        <Text style={paragraph}>
          If this was not you, change your password and revoke unfamiliar
          sessions immediately.
        </Text>
      </Section>
    </MailBody>
  );
};

export default PasskeyChangedEmail;
