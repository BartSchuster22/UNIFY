# First owner: credentials without an assistant

This guide is for the person installing their own DSH server. It does not enable
public registration. Additional users need an owner-controlled access workflow.

## At the end of installation

The installer prints the sign-in URL, the owner username selected with `--owner`,
and exact commands for local password retrieval and recovery. No password is
included in installation JSON, routine stdout/stderr, command arguments or Git.
Do not call onboarding complete just because the installer exited successfully.

On the **installation server**, in your normal SSH terminal (for example PuTTY),
run the printed `onboarding` command. It re-verifies the prepared bundle, checks
the owned installation, and queries the running identity service. It shows the
URL, username and whether an initial temporary password is still deliverable.
This status operation does not reset anything and does not reveal a password.

Example only—use the actual paths printed by your installer:

```sh
sudo python3 setup.py onboarding --destination /var/lib/alica-prepared --root /opt/dsh2-main
sudo python3 setup.py onboarding --destination /var/lib/alica-prepared --root /opt/dsh2-main --reveal-initial-password
```

The second command requires an interactive input AND output terminal, then asks
you to type `REVEAL`. It displays the temporary password directly on that terminal,
not in JSON or ordinary stdout. Disable PuTTY/session recording first. A terminal
recorder or screen capture can still record what is displayed; this is not a
claim that terminals are secret-proof. Pipes and output redirection are refused.

The initial handoff is claimed durably before display and is available **once**.
Save it securely before closing the terminal. Repeated retrieval, including after
a terminal failure, requires explicit recovery. This prevents a later password
expiry from causing the original password to be handed out again. Do not delete
`onboarding-initial-claimed.json` to bypass this guard.

Open the printed HTTPS URL in your browser, use the printed username and locally
retrieved password, choose your own password, then complete your real profile.
Continue with your chosen provider's normal consent flow. Never send passwords
or provider tokens to an assistant or support ticket.

## After changing your password

Your chosen password is authoritative. The original `secrets/owner-password`
file is NOT updated and is NOT a password-recovery mechanism. The helper checks
live identity state and refuses initial-password disclosure once the required
password-change action has cleared. A retained recovery file also blocks initial
handoff because file existence alone does not prove a password was activated.

The helper reports password state, not complete application onboarding. A
successful password change may still be followed by a profile-completion page.

## If you lose your chosen password

Run the printed `recover-owner` command on the installation server:

```sh
sudo python3 setup.py recover-owner --destination /var/lib/alica-prepared --root /opt/dsh2-main
```

It requires root, authenticated installation material, a running owned identity
service, an interactive terminal, and typing `RESET <owner-username>` exactly.
Cancellation does not reset anything. Recovery invokes the admitted lifecycle's
existing owner-recovery operation—not direct database edits or a Core password.
It replaces the owner's password with a new temporary one and revokes existing
identity sessions. Already issued access tokens may remain usable until expiry;
this is not a claim of instantaneous revocation of every application session.

Only after a successful recovery receipt and a fresh live check confirming the
temporary-password requirement does the helper display the new password on the
terminal. Failed or ambiguous recovery never displays a potentially inactive
password. Preserve diagnostics and retry explicit recovery; do not guess from a
leftover credential file. Log in again and choose a new password.

Recovery does not silently enable a disabled owner. Identity problems require
operator investigation. Loss of server/operator access requires the separate
host/backup recovery procedure; there is no public unauthenticated reset endpoint.

## Scope and acceptance

The setup kit includes this guide and `onboarding.py`. It is still a development
preview, not a frozen runtime release. Handoff tests include mocked failure cases
and a real local pseudo-terminal using a disposable generated test credential.
The existing development owner's live status can be read without changing its
password. Full fresh-install/recovery/browser acceptance of a final signed runtime
candidate remains a separate gate. Do not reset a human's current account merely
to test the helper without agreeing that disruption first.
