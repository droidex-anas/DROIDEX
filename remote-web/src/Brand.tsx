export function Brand() {
  return (
    <a className="brand" href="/__droidex_remote/app" aria-label="DROIDEX Remote home">
      <img src={`${import.meta.env.BASE_URL}icon.svg`} width="27" height="27" alt="" />
      <span>
        DROIDEX <span className="muted">Remote</span>
      </span>
    </a>
  );
}
