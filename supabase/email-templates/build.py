# Builds the six Supabase Auth email templates (Greek first, then English) in this folder.
# Edit the text here, then run: python build.py .

import os, sys
OUT = sys.argv[1]

FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
BG, CARD, LINE, TEXT, MUTED, BTN = '#080B09', '#101813', '#22302A', '#F3F5F2', '#929D98', '#103A29'


def button(url, label):
    return f'''<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;">
                <tr><td align="center" bgcolor="{BTN}" style="border-radius:999px;border:1px solid #C8CDD0;">
                  <a href="{url}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:{FONT};font-size:16px;font-weight:600;line-height:20px;color:#FFFFFF;text-decoration:none;border-radius:999px;">{label}</a>
                </td></tr>
              </table>'''


def code(token):
    return f'''<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 8px;">
                <tr><td bgcolor="#0B2219" style="border-radius:14px;border:1px solid {LINE};padding:14px 26px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:28px;font-weight:600;letter-spacing:6px;color:#FFFFFF;">{token}</td></tr>
              </table>'''


def p(text, muted=False, size=16):
    color = MUTED if muted else TEXT
    return f'<p style="margin:14px 0 0;font-family:{FONT};font-size:{size}px;line-height:1.55;color:{color};">{text}</p>'


def section(lang, title, paras, action, fallback, ignore):
    parts = [f'<h1 style="margin:0;font-family:{FONT};font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-0.3px;color:#FFFFFF;">{title}</h1>']
    parts += [p(x) for x in paras]
    parts.append(action)
    if fallback:
        parts.append(p(fallback, muted=True, size=13))
    parts.append(p(ignore, muted=True, size=13))
    body = '\n              '.join(parts)
    return f'<div lang="{lang}">\n              {body}\n              </div>'


def page(subject, preheader, el, en):
    return f'''<!doctype html>
<html lang="el">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>{subject}</title>
</head>
<body style="margin:0;padding:0;background:{BG};">
  <!-- Preview line shown in the inbox list -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">{preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{BG}" style="background:{BG};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
          <tr>
            <td style="padding:0 4px 20px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="vertical-align:middle;"><img src="https://onusmu.com/assets/emblem-96.png" width="36" height="36" alt="" style="display:block;border:0;"></td>
                <td style="vertical-align:middle;padding-left:10px;font-family:{FONT};font-size:19px;font-weight:600;letter-spacing:-0.3px;color:#FFFFFF;">Onusmu</td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td bgcolor="{CARD}" style="background:{CARD};border:1px solid {LINE};border-radius:22px;padding:32px 28px;">
              {section('el', *el)}
              <div style="height:1px;line-height:1px;font-size:1px;background:{LINE};margin:30px 0;">&nbsp;</div>
              {section('en', *en)}
            </td>
          </tr>
          <tr>
            <td style="padding:22px 4px 0;font-family:{FONT};font-size:12px;line-height:1.6;color:{MUTED};">
              Onusmu · Η δεύτερη μνήμη σου · Your second memory<br>
              <a href="https://onusmu.com" style="color:{MUTED};text-decoration:underline;">onusmu.com</a>
              &nbsp;·&nbsp; <a href="https://onusmu.com/support.html" style="color:{MUTED};text-decoration:underline;">Υποστήριξη / Support</a>
              &nbsp;·&nbsp; <a href="https://onusmu.com/privacy.html" style="color:{MUTED};text-decoration:underline;">Απόρρητο / Privacy</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
'''


URL, TOKEN = '{{ .ConfirmationURL }}', '{{ .Token }}'
B = 'style="color:#FFFFFF;"'
link_el = f'Αν το κουμπί δεν λειτουργεί, αντέγραψε αυτόν τον σύνδεσμο στον browser σου:<br><a href="{URL}" style="color:#C8CDD0;word-break:break-all;">{URL}</a>'
link_en = f'If the button doesn’t work, copy this link into your browser:<br><a href="{URL}" style="color:#C8CDD0;word-break:break-all;">{URL}</a>'

T = {
    'confirm-signup': (
        'Επιβεβαίωσε το email σου · Confirm your email',
        'Ένα βήμα ακόμα για τον λογαριασμό σου στο Onusmu.',
        ('Επιβεβαίωσε το email σου',
         [f'Καλώς ήρθες στο Onusmu. Πάτα το κουμπί για να επιβεβαιώσεις το <strong {B}>{{{{ .Email }}}}</strong> και να ενεργοποιήσεις τον λογαριασμό σου.'],
         button(URL, 'Επιβεβαίωση email'), link_el, 'Αν δεν δημιούργησες εσύ λογαριασμό, αγνόησε αυτό το email.'),
        ('Confirm your email',
         [f'Welcome to Onusmu. Tap the button to confirm <strong {B}>{{{{ .Email }}}}</strong> and activate your account.'],
         button(URL, 'Confirm email'), link_en, 'If you didn’t create an account, you can ignore this email.')),
    'invite-user': (
        'Πρόσκληση στο Onusmu · You’re invited to Onusmu',
        'Σε προσκάλεσαν να δημιουργήσεις λογαριασμό στο Onusmu.',
        ('Σε προσκάλεσαν στο Onusmu',
         ['Σε προσκάλεσαν να δημιουργήσεις λογαριασμό στο Onusmu, την προσωπική σου μνήμη που βρίσκει ό,τι έχεις πει απλώς ρωτώντας.'],
         button(URL, 'Αποδοχή πρόσκλησης'), link_el, 'Αν δεν περίμενες αυτή την πρόσκληση, αγνόησε αυτό το email.'),
        ('You’re invited to Onusmu',
         ['You’ve been invited to create an Onusmu account: a personal memory that finds anything you’ve said, simply by asking.'],
         button(URL, 'Accept invitation'), link_en, 'If you weren’t expecting this invitation, you can ignore this email.')),
    'magic-link': (
        'Σύνδεση στο Onusmu · Sign in to Onusmu',
        'Ο σύνδεσμος και ο κωδικός σύνδεσής σου.',
        ('Σύνδεση στο Onusmu',
         ['Πάτα το κουμπί για να συνδεθείς ή χρησιμοποίησε αυτόν τον κωδικό μίας χρήσης:'],
         code(TOKEN) + button(URL, 'Σύνδεση'), link_el,
         'Ο σύνδεσμος και ο κωδικός ισχύουν για λίγη ώρα και μόνο μία φορά. Αν δεν ζήτησες σύνδεση, αγνόησε αυτό το email.'),
        ('Sign in to Onusmu',
         ['Tap the button to sign in, or use this one-time code:'],
         code(TOKEN) + button(URL, 'Sign in'), link_en,
         'The link and code work once and expire soon. If you didn’t ask to sign in, you can ignore this email.')),
    'change-email': (
        'Επιβεβαίωσε το νέο σου email · Confirm your new email',
        'Επιβεβαίωσε την αλλαγή email στον λογαριασμό σου στο Onusmu.',
        ('Επιβεβαίωσε το νέο σου email',
         [f'Ζητήθηκε αλλαγή του email του λογαριασμού σου στο Onusmu από <strong {B}>{{{{ .Email }}}}</strong> σε <strong {B}>{{{{ .NewEmail }}}}</strong>. Πάτα το κουμπί για να την επιβεβαιώσεις.'],
         button(URL, 'Επιβεβαίωση αλλαγής'), link_el,
         'Αν δεν ζήτησες εσύ αυτή την αλλαγή, μην πατήσεις τον σύνδεσμο και άλλαξε τον κωδικό σου.'),
        ('Confirm your new email',
         [f'A change of your Onusmu account email from <strong {B}>{{{{ .Email }}}}</strong> to <strong {B}>{{{{ .NewEmail }}}}</strong> was requested. Tap the button to confirm it.'],
         button(URL, 'Confirm change'), link_en,
         'If you didn’t request this change, don’t open the link, and change your password.')),
    'reset-password': (
        'Επαναφορά κωδικού · Reset your password',
        'Διάλεξε νέο κωδικό για τον λογαριασμό σου στο Onusmu.',
        ('Επαναφορά κωδικού',
         [f'Ζητήθηκε επαναφορά του κωδικού για το <strong {B}>{{{{ .Email }}}}</strong>. Πάτα το κουμπί για να διαλέξεις νέο κωδικό.'],
         button(URL, 'Νέος κωδικός'), link_el,
         'Ο σύνδεσμος ισχύει για λίγη ώρα. Αν δεν ζήτησες επαναφορά, αγνόησε αυτό το email· ο κωδικός σου δεν αλλάζει.'),
        ('Reset your password',
         [f'We received a request to reset the password for <strong {B}>{{{{ .Email }}}}</strong>. Tap the button to choose a new one.'],
         button(URL, 'Choose a new password'), link_en,
         'The link expires soon. If you didn’t ask for a reset, you can ignore this email; your password stays the same.')),
    'reauthentication': (
        'Ο κωδικός επιβεβαίωσης · Your verification code',
        'Ο κωδικός για να επιβεβαιώσεις ότι είσαι εσύ.',
        ('Επιβεβαίωσε ότι είσαι εσύ',
         ['Χρησιμοποίησε αυτόν τον κωδικό για να συνεχίσεις:'],
         code(TOKEN), None, 'Ο κωδικός ισχύει για λίγη ώρα. Αν δεν τον ζήτησες εσύ, άλλαξε τον κωδικό σου.'),
        ('Confirm it’s you',
         ['Use this code to continue:'],
         code(TOKEN), None, 'The code expires soon. If you didn’t ask for it, change your password.')),
}

for name, (subject, pre, el, en) in T.items():
    with open(os.path.join(OUT, name + '.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(page(subject, pre, el, en))
    print(f'{name}.html | {subject}')
