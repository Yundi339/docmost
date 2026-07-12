import { Link, Section, Text } from 'react-email';
import * as React from 'react';
import { content, paragraph } from '../css/styles';
import { MailBody } from '../partials/partials';

interface Props {
  username?: string;
  confirmationLink: string;
}

export const EmailChangeConfirmationEmail = ({
  username,
  confirmationLink,
}: Props) => (
  <MailBody>
    <Section style={content}>
      <Text style={paragraph}>Hi {username || 'there'},</Text>
      <Text style={paragraph}>
        Confirm this address to finish changing the email on your account.
      </Text>
      <Link href={confirmationLink}>Confirm email change</Link>
      <Text style={paragraph}>This link is valid for 30 minutes.</Text>
      <Text style={paragraph}>
        If you did not request this change, you can ignore this email.
      </Text>
    </Section>
  </MailBody>
);

export default EmailChangeConfirmationEmail;
