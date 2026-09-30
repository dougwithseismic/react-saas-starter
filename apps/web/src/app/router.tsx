import { Button, Feedback } from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { lazy, useEffect, useRef } from "react";

const AccountPage = lazy(() => import("../features/account/page"));
const AuthForm = lazy(() =>
  import("../features/auth/forms").then((module) => ({
    default: module.AuthForm,
  })),
);

import { Loading } from "../components/query-state";
import { sessionOptions } from "../features/auth/queries";
import HomePage from "../features/home/page";

const InvitationPage = lazy(
  () => import("../features/organisations/invitation"),
);
const OrganisationsPage = lazy(() => import("../features/organisations/page"));

import { organisationSearch } from "../features/organisations/search";
import { analytics, analyticsPath } from "../lib/analytics";
import { ApiError, authClient, unwrap } from "../lib/auth-client";
import { onRemoteAuthChange, publishAuthChange } from "../lib/auth-events";
import { queryClient } from "../lib/query-client";
import { useUiStore } from "../stores/ui-store";

function Root() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const lastPage = useRef<string | null>(null);
  const session = useQuery(sessionOptions);
  useEffect(() => {
    if (session.isSuccess) analytics.identify(session.data?.user.id ?? null);
  }, [session.isSuccess, session.data?.user.id]);
  useEffect(() => {
    if (!session.isSuccess || lastPage.current === pathname) return;
    lastPage.current = pathname;
    const path = analyticsPath(pathname);
    analytics.track("$pageview", {
      path,
      $current_url: `${window.location.origin}${path}`,
    });
  }, [pathname, session.isSuccess]);
  const theme = useUiStore((state) => state.theme);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function update() {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    }
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);
  useEffect(() => onRemoteAuthChange(() => void router.invalidate()), []);
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Outlet />
    </>
  );
}
function Public() {
  return (
    <>
      <header className="site-header">
        <Link to="/" className="brand">
          React SaaS Starter
        </Link>
        <Link to="/account">Your account</Link>
      </header>
      <Outlet />
    </>
  );
}
function Protected() {
  const session = useQuery(sessionOptions),
    navigate = useNavigate(),
    ui = useUiStore();
  const signOut = useMutation({
    mutationFn: async () => unwrap(await authClient.signOut()),
    onSuccess: async () => {
      analytics.track("signed_out");
      analytics.reset();
      await queryClient.cancelQueries();
      queryClient.clear();
      publishAuthChange();
      await navigate({ to: "/sign-in" });
    },
  });
  useEffect(() => {
    if (session.isSuccess && !session.data) void navigate({ to: "/sign-in" });
  }, [session.isSuccess, session.data, navigate]);
  return (
    <div className="shell">
      {ui.navigationOpen && (
        <button
          type="button"
          className="mobile-backdrop"
          aria-label="Close navigation"
          onClick={ui.closeNavigation}
        />
      )}
      <aside className={`sidebar ${ui.navigationOpen ? "open" : ""}`}>
        <Link className="brand" to="/">
          React SaaS Starter
        </Link>
        <nav aria-label="Main navigation">
          <Link to="/account" onClick={ui.closeNavigation}>
            Account
          </Link>
          <Link to="/organisations" onClick={ui.closeNavigation}>
            Organisations
          </Link>
        </nav>
        <div className="sidebar-footer">
          <p className="user">{session.data?.user.email}</p>
          <label>
            Theme
            <select
              value={ui.theme}
              onChange={(event) =>
                ui.setTheme(event.target.value as "system" | "light" | "dark")
              }
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <Feedback error={signOut.error?.message} />
          <Button
            variant="secondary"
            disabled={signOut.isPending}
            onClick={() => signOut.mutate()}
          >
            Sign out
          </Button>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-header">
          <Button
            className="menu-toggle"
            variant="secondary"
            aria-label="Toggle navigation"
            aria-expanded={ui.navigationOpen}
            onClick={ui.toggleNavigation}
          >
            <Menu size={18} />
          </Button>
          <span>Account and organisation settings</span>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
const root = createRootRoute({
  component: Root,
  notFoundComponent: () => (
    <main id="main-content" className="page">
      <h1>Page not found</h1>
      <Link to="/">Return home</Link>
    </main>
  ),
  errorComponent: ({ error, reset }) => (
    <main id="main-content" className="page">
      <Feedback
        error={error instanceof Error ? error.message : "Something went wrong."}
      />
      <Button onClick={reset}>Try again</Button>
    </main>
  ),
});
const publicRoute = createRoute({
  getParentRoute: () => root,
  id: "public",
  component: Public,
});
const home = createRoute({
  getParentRoute: () => publicRoute,
  path: "/",
  component: HomePage,
});
const authRoutes = (
  ["sign-in", "sign-up", "forgot-password", "reset-password"] as const
).map((mode) =>
  createRoute({
    getParentRoute: () => publicRoute,
    path: `/${mode}`,
    component: () => <AuthForm mode={mode} />,
  }),
);
const protectedRoute = createRoute({
  getParentRoute: () => root,
  id: "protected",
  component: Protected,
  beforeLoad: async ({ location }) => {
    let session: Awaited<ReturnType<typeof authClient.getSession>>["data"] =
      null;
    try {
      session = await queryClient.fetchQuery(sessionOptions);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401)
        throw redirect({ to: "/sign-in", search: { redirect: location.href } });
      throw error;
    }
    if (!session)
      throw redirect({ to: "/sign-in", search: { redirect: location.href } });
  },
});
const account = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/account",
  component: AccountPage,
});
const organisations = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/organisations",
  component: OrganisationsPage,
  validateSearch: (search) => organisationSearch.parse(search),
});
const invitation = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/invitations/$invitationId",
  component: InvitationPage,
});
export const router = createRouter({
  routeTree: root.addChildren([
    publicRoute.addChildren([home, ...authRoutes]),
    protectedRoute.addChildren([account, organisations, invitation]),
  ]),
  defaultPreload: "intent",
  defaultPendingComponent: Loading,
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
