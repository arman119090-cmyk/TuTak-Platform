export function PageIntro({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-intro">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="page-intro__title">{title}</h1>
      {intro ? <p className="page-intro__text">{intro}</p> : null}
      {children}
    </header>
  );
}
