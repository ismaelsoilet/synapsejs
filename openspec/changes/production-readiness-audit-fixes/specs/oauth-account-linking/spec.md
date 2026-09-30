# Spec Delta

## Purpose

Specifies the security contract the generated GitHub OAuth login template must satisfy — a CSRF-bound state round-trip, a verified email, no role inheritance across an identity link, and a UI that can actually finish the login — so that adopting the template cannot yield an account takeover.

## ADDED Requirements

### Requirement: The authorization round-trip is bound by a CSRF state value
The generated component SHALL place a single-use, unpredictable `state` value on the authorization request it sends to the provider, and the generated action SHALL require a `state` in its input contract and validate it against the value bound to the initiating session before exchanging the code. A callback whose state is absent, unrecognised, or already consumed SHALL be refused with a distinct `INVALID_STATE` error and SHALL NOT exchange the code, SHALL NOT create or link any account, and SHALL NOT issue a token.

#### Scenario: Authorization request carries a state
- **WHEN** the generated component starts the authorization redirect
- **THEN** the redirect URL includes a `state` parameter whose value is unpredictable and not derived from a guessable source

#### Scenario: Valid state is accepted
- **WHEN** the generated action is called with a code and the state bound to the initiating session
- **THEN** the code is exchanged and the flow proceeds to identity resolution

#### Scenario: Missing or mismatched state is refused
- **WHEN** the generated action is called with a valid provider code but no state, or with a state that does not match the initiating session
- **THEN** the result is an `INVALID_STATE` error, no call is made to the provider's token endpoint, and no token is issued

#### Scenario: State is single-use and time-bounded
- **WHEN** a state value that was already consumed, or one presented after the round-trip window has elapsed, is presented again
- **THEN** the result is an `INVALID_STATE` error and no second session is issued

### Requirement: Only a provider-verified email establishes an identity
The generated action SHALL obtain the email from the provider's email-verification endpoint rather than from the profile document, and SHALL require that the address it uses is marked verified by the provider. It SHALL NOT synthesize an address from the provider login or identifier as a fallback. When no verified address is available, the action SHALL return a distinct `EMAIL_NOT_VERIFIED` error and SHALL NOT create an account, link an account, or issue a token.

#### Scenario: Verified address is used
- **WHEN** the provider reports an address marked verified
- **THEN** the action proceeds with that address as the identity email

#### Scenario: Unverified address is refused
- **WHEN** the only address the provider reports for the account is marked unverified
- **THEN** the result is an `EMAIL_NOT_VERIFIED` error, no account is created or linked, and no token is issued

#### Scenario: No address is refused
- **WHEN** the provider reports no address at all
- **THEN** the result is an `EMAIL_NOT_VERIFIED` error rather than an address derived from the provider login

#### Scenario: No synthesized address is stored
- **WHEN** an account is created through the generated action
- **THEN** the stored email is an address the provider reported as verified, and no placeholder address derived from the provider login exists

### Requirement: An unverified match never binds a foreign account
A provider account with no existing link SHALL NOT be bound to a pre-existing local account on the strength of an email string match alone, and SHALL NOT inherit that account's identifier or role set. The generated action SHALL return a distinct `ACCOUNT_LINK_CONFLICT` error and issue no token in that case, leaving the link to an explicit, deliberate association step. When a provider account is already linked, the roles in the issued token SHALL be the linked user's roles read at issuance time, so a role change takes effect on the next login.

#### Scenario: Email match alone does not take over the local account
- **WHEN** a first-time provider login presents a verified email that matches an existing local account
- **THEN** the result is an `ACCOUNT_LINK_CONFLICT` error, no link row is created, and no token is issued

#### Scenario: The local account's roles are never copied
- **WHEN** any flow reaches the point of issuing a token for a provider account
- **THEN** the role claims in the token are exactly the roles established for the resolved identity, and no role set was inherited because an email string matched a local row

#### Scenario: A new identity receives only the default roles
- **WHEN** a first-time provider login presents a verified email that matches no local account
- **THEN** the created account is granted the template's default role set and nothing more, and the token carries only those roles

#### Scenario: Role changes take effect on the next login
- **WHEN** an already-linked identity's role set is reduced and that identity logs in again
- **THEN** the newly issued token carries the reduced role set

### Requirement: Identifiers are drawn from a cryptographic source
Every identifier the generated action mints — for a new user, for a new provider link, and for anything else it persists — SHALL be produced by a cryptographically strong source. A non-cryptographic random source SHALL NOT be used for any stored identifier, and the generated identifiers SHALL satisfy the uniqueness constraint of the tables they are inserted into.

#### Scenario: New user identifier is cryptographically strong
- **WHEN** the generated action creates a new user
- **THEN** the identifier is produced by a cryptographically strong source, and it satisfies the format the framework uses elsewhere for identifiers

#### Scenario: New provider link identifier is cryptographically strong
- **WHEN** the generated action creates a provider-account link
- **THEN** its identifier is produced by a cryptographically strong source

#### Scenario: No non-cryptographic source remains in the template
- **WHEN** the generated template source is searched for a non-cryptographic random call used to build an identifier
- **THEN** none is found

### Requirement: The generated template can complete a login by itself
The generated component SHALL declare, destructure and invoke the submit callback it is handed, SHALL carry the state value from the initiating render to the callback, and SHALL persist the session the action mints using the framework's session-storage primitive before redirecting. The generated template SHALL NOT be shipped in a state where the user is redirected to the provider and no further progress is possible.

#### Scenario: Submit callback is wired
- **WHEN** the generated template source is inspected for the submit callback it declares
- **THEN** the component destructures that prop and invokes it with the authorization code and the state value

#### Scenario: State reaches the action
- **WHEN** the generated component initiates and completes the authorization step
- **THEN** the state value it generated is included in the payload it passes to the action

#### Scenario: Minted session is persisted
- **WHEN** the generated action returns a token
- **THEN** the generated component stores that token with its roles and expiry through the framework's session-storage primitive before redirecting

#### Scenario: The template is end-to-end completable
- **WHEN** a reviewer follows the generated template's own documented steps from a fresh application
- **THEN** a login completes and an authenticated request is accepted, with no manual wiring step left undone

### Requirement: The generated oracles cover identity linking and token issuance
The generated template's own oracle suite SHALL exercise the identity-linking and token-issuance behaviour, not only the early configuration guards. It SHALL cover at minimum: a refused state, a refused unverified email, a refused account-link conflict, the default role set issued to a new identity, and the persistence of the issued session by the generated component. The generated oracle for the OAuth template SHALL be at least as strong as the one generated for the password-login template, which already proves that the token the action issues is accepted by the server's own token-verification function.

#### Scenario: Linking region is covered
- **WHEN** the generated OAuth template's oracle cases are enumerated
- **THEN** at least one case drives the action past the configuration guards into identity resolution and token issuance

#### Scenario: Issued token is proven acceptable by the server
- **WHEN** the generated oracle issues a token through the action
- **THEN** the oracle verifies that token with the server's own token-verification function and asserts the resulting claims, and the case fails if the server would reject it

#### Scenario: Every refusal path has a case
- **WHEN** the generated oracle suite is compared against the set of error codes the generated action can return for security refusals
- **THEN** each of the state, unverified-email and account-link-conflict refusals has its own named case

#### Scenario: Oracle fails when the behaviour breaks
- **WHEN** the generated action is changed to inherit roles on an email match
- **THEN** the generated oracle suite fails

### Requirement: The login template's reference properties hold for OAuth
The generated OAuth template SHALL preserve the properties that make the generated password-login template the reference: it SHALL fail closed with a distinct error when the session-signing secret is missing rather than minting a token no server would accept, and it SHALL NOT disclose whether a local account exists. No error it returns SHALL distinguish an unknown identity from a rejected one.

#### Scenario: Missing secret fails closed
- **WHEN** the generated action is invoked with no session-signing secret configured
- **THEN** it returns the missing-secret error and issues no token, rather than minting a token the server would not accept

#### Scenario: Unknown and rejected are indistinguishable
- **WHEN** the generated action fails to resolve an identity, and separately fails on an identity that is refused
- **THEN** both failures return the same error code and neither reveals whether a local account exists

#### Scenario: Configuration guards still return their own codes
- **WHEN** the provider credentials are absent
- **THEN** the result is the provider-configuration error, distinct from any identity-resolution refusal
