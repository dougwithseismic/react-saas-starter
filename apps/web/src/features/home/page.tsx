import { Link } from "@tanstack/react-router";
export default function HomePage() {
  return (
    <main id="main-content" className="page">
      <section className="hero">
        <h1>A place to begin.</h1>
        <p>Your account, your organisation, and a space for what comes next.</p>
        <div className="actions">
          <Link className="button primary" to="/sign-up">
            Create an account
          </Link>
          <Link className="button secondary" to="/sign-in">
            Sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
