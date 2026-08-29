# Acyberschool institutional LMS architecture

## Product goal

A single Acyberschool deployment should host many independent institutions. Each institution is an organization tenant with its own branding, administrators, learners, courses, invitations, reporting and domain. The public Acyberschool catalogue remains a separate tenant experience on `classroom.acyberschool.com`.

There is no global application-level cap on the number of organization tenants. Practical capacity is governed by database, object storage, email and compute resources and should be monitored rather than encoded as a tenant-count ceiling.

## Domain model

Use these host patterns:

* Public Acyberschool: `classroom.acyberschool.com`
* Acyberschool-managed institutional hostname: `<slug>.classroom.acyberschool.com`, for example `worldbank.classroom.acyberschool.com`
* Institution-owned vanity hostname: a domain the institution controls, for example `learning.worldbank.org`

`classroom.acyberschool.worldbank` is not a subdomain of `acyberschool.com`, so it should not be used as the managed-host pattern.

Managed tenant hostnames require wildcard DNS and TLS for `*.classroom.acyberschool.com`. Vanity domains use the existing custom-domain ownership verification flow before activation.

## Tenant boundary

Every tenant is an organization. Tenant-owned records must always be scoped by `org_id` or `org_uuid`, including:

* organization settings and branding
* courses, activities and media
* users, roles and invitations
* cohorts or employee groups
* completion and progress data
* certificates
* payments and entitlements
* analytics and exports

A user may belong to more than one institution, but each request is evaluated in the context of the resolved organization and that user's role in it.

## Host resolution

The request host should resolve in this order:

1. A verified custom domain maps directly to its organization.
2. A hostname matching `<slug>.classroom.acyberschool.com` maps to the organization slug.
3. `classroom.acyberschool.com` maps to the public Acyberschool organization.
4. Unknown hosts are rejected rather than silently falling through to another tenant.

The ingress must preserve the original Host header. Media and API requests must remain same-origin so that the same branding and course content work on the primary domain, managed tenant subdomains and vanity domains.

## Institutional provisioning workflow

Acyberschool needs a platform-admin control centre above ordinary organization administration. The platform operator should be able to create an institution, assign an institutional administrator, upload its logo and brand assets, set typography and interface colours, choose a hostname, attach or co-develop courses, configure enrollment and publish the tenant.

The institutional administrator should then be able to manage only their organization, invite employees in batches by email, create reusable or limited-use join codes, assign learners to courses or cohorts, view progress, export reports and manage institution-specific content permitted by Acyberschool.

## Branding

Branding should be organization data, not deployment data. At minimum every organization should have:

* display name and short name
* primary logo, compact logo and favicon
* primary and accent interface colours
* login/background image
* email display name
* certificate logo and footer text
* optional support contact

Media URLs must never contain an internal Docker hostname or private storage address. Browser-facing organization logos, thumbnails, documents, video and audio use the public request origin and the shared `/content` or `/api/v1/stream` routes.

## Enrollment

The existing organization invitation model should be used for two institutional entry paths:

* Email invitations, including batch employee invitations.
* Join codes with expiry and maximum-use controls.

A later enterprise-import option can accept CSV rosters and, where required, identity-provider provisioning through SSO or SCIM.

## Email

All platform mail should authenticate through the shared Acyberschool sender address `noreply@acyberschool.com`. An institution may customize only the display name unless Acyberschool explicitly provisions and verifies a separate sending domain for it. This keeps SPF and DKIM alignment predictable across tenants.

## Public course commerce

Public courses on `classroom.acyberschool.com` should be delivered through a catalogue layer that sits above the existing course and organization model. A public product references a course, price, currency, tax policy and enrollment rule. Successful checkout creates or links the learner account, records the entitlement and enrolls the learner into the purchased course automatically.

This should be implemented after institutional tenancy is stable because it depends on the same identity, tenant, course, email and entitlement boundaries.

## Delivery phases

### Phase 1: reliability and tenancy foundation

* Same-origin media and streaming across primary, managed and vanity domains.
* Acyberschool sender identity.
* Explicit native multi-organization mode through `LEARNHOUSE_TENANCY=multi`.
* Wildcard-capable ingress and original Host preservation.
* Existing custom-domain verification, email invitations and join-code services retained.

### Phase 2: Acyberschool institutional control centre

* Platform-admin-only institution creation and lifecycle controls.
* Guided branding setup with preview.
* Managed subdomain assignment and custom-domain setup status.
* Course attachment, cloning and co-development workflow.
* Institutional administrator assignment.
* Employee batch invitations, codes and cohort assignment in one launch workflow.
* Tenant-level progress and reporting dashboard.

### Phase 3: enterprise identity and scale operations

* SSO options where required by institutional clients.
* Optional SCIM or roster synchronization.
* Per-tenant quotas and usage metering without a hard global organization cap.
* Audit trail for platform-admin and institutional-admin actions.
* Automated domain, certificate and email-health checks.

### Phase 4: public course catalogue and payments

* Public catalogue on `classroom.acyberschool.com`.
* Course product and pricing records.
* Checkout and payment confirmation.
* Automatic account creation or login and enrollment after payment.
* Receipts, refunds and entitlement revocation rules.
* Public learner dashboard alongside institutional memberships.

## Production configuration

For Acyberschool's hosted multi-tenant environment the deployment must explicitly set `LEARNHOUSE_TENANCY=multi`. It must also configure the public domain, shared cookie scope and CORS/CSRF host pattern for the chosen managed-host hierarchy. Wildcard DNS and TLS should point `*.classroom.acyberschool.com` at the same ingress as `classroom.acyberschool.com`.

The mail provider must verify `acyberschool.com` for the configured `noreply@acyberschool.com` address with SPF and DKIM. DMARC should be enabled after alignment is confirmed.

## Acceptance tests

Before calling institutional tenancy production-ready, test at least two organizations with different branding and courses on desktop, iPhone and Android. Verify that tenant A cannot retrieve tenant B's administration data or protected course content, and that logo, thumbnails, documents, video seeking, audio, sign-in, invitation email, join-code enrollment and progress tracking all work on the public domain, a managed institutional subdomain and one verified vanity domain.
