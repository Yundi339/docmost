import { Section, Text } from 'react-email';
import * as React from 'react';
import { content, paragraph } from '../css/styles';
import { MailBody } from '../partials/partials';

interface Props {
  username?: string;
  newEmail: string;
}

export const EmailChangedEmail = ({ username, newEmail }: Props) => (
  <MailBody>
    <Section style={content}>
      <Text style={paragraph}>Hi {username || 'there'},</Text>
      <Text style={paragraph}>
        The email address on your account was changed to {newEmail}.
      </Text>
      <Text style={paragraph}>
        If this was not you, change your password and revoke unfamiliar sessions
        immediately.
      </Text>
    </Section>
  </MailBody>
);

export default EmailChangedEmail;
