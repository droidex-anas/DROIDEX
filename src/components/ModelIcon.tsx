import type { ModelInfo } from '../types/bridge';

export type Provider =
  | 'anthropic'
  | 'claude'
  | 'openai'
  | 'google'
  | 'factory'
  | 'meta'
  | 'mistral'
  | 'xai'
  | 'copilot'
  | 'junie'
  | 'kimi'
  | 'default';

// Model identity (id + display name) decides first: custom models report a
// generic provider such as "openai" even when they are Meta, xAI, or Kimi
// models served through a proxy. The provider field only breaks ties, and
// never for custom models, where it names the wire protocol, not the maker.
export function providerOf(model?: ModelInfo, modelId?: string): Provider {
  const identity = `${model?.displayName ?? ''} ${model?.id ?? modelId ?? ''}`.toLowerCase();
  const specific = providerForIdentity(identity);
  if (specific) return specific;
  if (model?.isCustom) return 'default';
  const hay = `${model?.provider ?? ''} ${identity}`;
  return providerForIdentity(hay) ?? 'default';
}

function providerForIdentity(hay: string): Provider | undefined {
  // Makers before wrappers: a Copilot- or Junie-served Claude is still
  // Claude, so the maker token wins wherever the name carries both.
  if (/anthropic|claude/.test(hay)) return 'anthropic';
  if (/\bmeta\b|\bmuse\b|\bllama\b/.test(hay)) return 'meta';
  if (/\bgrok\b|\bxai\b|x\.ai/.test(hay)) return 'xai';
  if (/\bkimi\b|moonshot/.test(hay)) return 'kimi';
  if (/openai|gpt|codex|\bo1\b|\bo3\b|\bo4\b/.test(hay)) return 'openai';
  if (/google|gemini|antigravity/.test(hay)) return 'google';
  if (/mistral|mixtral/.test(hay)) return 'mistral';
  if (hay.includes('copilot')) return 'copilot';
  if (/junie|jetbrains/.test(hay)) return 'junie';
  if (/glm|deepseek|minimax|qwen|droid core|factory/.test(hay)) return 'factory';
  return undefined;
}

function FactoryMark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 67 65"
      fill="none"
      className="shrink-0 text-droid-text"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M47.75 11.15a.867.867 0 0 1-.671-.806.84.84 0 0 1 .067-.362c1.688-4.007 2.433-7.213 1.23-8.555-3.183-3.56-15.952 3.52-20.024 5.919a.9.9 0 0 1-1.273-.41c-1.711-3.998-3.51-6.78-5.334-6.9-4.833-.323-8.73 13.49-9.87 17.992a.85.85 0 0 1-.459.563.9.9 0 0 1-.737.027c-4.109-1.647-7.398-2.373-8.773-1.2-3.651 3.104 3.609 15.557 6.068 19.528a.85.85 0 0 1-.11 1.031.9.9 0 0 1-.31.21C3.455 39.856.604 41.61.478 43.389c-.329 4.713 13.834 8.513 18.452 9.625q.186.046.337.163a.87.87 0 0 1 .332.642.84.84 0 0 1-.067.362c-1.688 4.007-2.433 7.214-1.23 8.555 3.183 3.561 15.954-3.519 20.025-5.917a.9.9 0 0 1 1.058.107.9.9 0 0 1 .215.302c1.711 3.997 3.509 6.779 5.334 6.9 4.833.322 8.73-13.49 9.868-17.993a.85.85 0 0 1 .168-.33.88.88 0 0 1 .659-.324.9.9 0 0 1 .371.066c4.109 1.647 7.397 2.372 8.773 1.2 3.651-3.105-3.61-15.559-6.07-19.53a.85.85 0 0 1 .111-1.03.9.9 0 0 1 .31-.21c4.1-1.67 6.952-3.424 7.075-5.203.331-4.713-13.833-8.513-18.45-9.623m-5.546-4.518c.93 1.624-3.858 12.446-7.42 20.015a.7.7 0 0 1-.28.303.71.71 0 0 1-.796-.059.7.7 0 0 1-.23-.341c-1.439-4.921-3.082-10.704-4.841-15.612a.84.84 0 0 1 .01-.594.87.87 0 0 1 .401-.446c4.392-2.34 11.908-5.446 13.156-3.266m-21.048 1.34c1.833.507 6.294 11.46 9.264 19.268a.67.67 0 0 1-.2.754.71.71 0 0 1-.794.08c-4.589-2.485-9.94-5.444-14.743-7.702a.87.87 0 0 1-.422-.427.84.84 0 0 1-.04-.591c1.414-4.679 4.471-12.063 6.935-11.383M7.243 23.433c1.664-.906 12.762 3.763 20.522 7.235.13.058.239.154.311.274a.67.67 0 0 1-.06.776.7.7 0 0 1-.35.225c-5.045 1.403-10.976 3.006-16.01 4.721a.9.9 0 0 1-.607-.01.88.88 0 0 1-.456-.391c-2.395-4.284-5.586-11.613-3.35-12.83M8.617 43.96c.519-1.788 11.752-6.14 19.758-9.035a.72.72 0 0 1 .773.195.67.67 0 0 1 .081.774c-2.548 4.475-5.582 9.694-7.898 14.377a.87.87 0 0 1-.437.413.9.9 0 0 1-.607.039c-4.797-1.37-12.37-4.36-11.67-6.763m15.855 13.568c-.93-1.623 3.859-12.446 7.42-20.014a.7.7 0 0 1 .28-.303.715.715 0 0 1 .796.059.7.7 0 0 1 .23.34c1.439 4.92 3.083 10.705 4.841 15.613a.84.84 0 0 1-.01.593.87.87 0 0 1-.402.445c-4.391 2.335-11.908 5.447-13.15 3.267zm21.049-1.34c-1.836-.506-6.297-11.461-9.266-19.269a.67.67 0 0 1 .2-.755.71.71 0 0 1 .795-.078c4.587 2.484 9.94 5.445 14.742 7.703.189.088.339.24.423.426a.84.84 0 0 1 .039.592c-1.413 4.686-4.47 12.063-6.933 11.381m13.912-15.462c-1.665.907-12.762-3.763-20.523-7.236a.7.7 0 0 1-.311-.273.67.67 0 0 1 .06-.777.7.7 0 0 1 .35-.225c5.046-1.402 10.975-3.005 16.009-4.72a.9.9 0 0 1 .609.01.88.88 0 0 1 .457.392c2.393 4.282 5.584 11.613 3.349 12.829M58.06 20.2c-.521 1.79-11.753 6.14-19.759 9.036a.72.72 0 0 1-.774-.195.67.67 0 0 1-.08-.776c2.547-4.474 5.581-9.694 7.897-14.377a.87.87 0 0 1 .437-.412.9.9 0 0 1 .607-.038c4.797 1.377 12.37 4.359 11.672 6.762"
      />
    </svg>
  );
}

export function ModelIcon({ provider, size = 18 }: { provider: Provider; size?: number }) {
  const s = { width: size, height: size };

  if (provider === 'anthropic')
    return (
      <svg {...s} viewBox="0 0 24 24" fill="none" className="shrink-0 text-droid-text" aria-hidden>
        <path
          fill="currentColor"
          d="m13.788825 3.932 6.43325 16.136075h3.5279L17.316725 3.932H13.788825Z"
        />
        <path
          fill="currentColor"
          d="m6.325375 13.682775 2.20125 -5.67065 2.201275 5.67065H6.325375ZM6.68225 3.932 0.25 20.068075h3.596525l1.3155 -3.3886h6.729425l1.315275 3.3886h3.59655L10.371 3.932H6.68225Z"
        />
      </svg>
    );

  // Claude's own sunburst in brand orange, used for the Claude Code
  // harness identity. Models made by Anthropic keep the 'anthropic' mark.
  if (provider === 'claude')
    return (
      <svg {...s} viewBox="0 0 24 24" className="shrink-0" aria-hidden>
        <path
          d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
          fill="#D97757"
          fillRule="nonzero"
        ></path>
      </svg>
    );

  if (provider === 'openai')
    return (
      <svg {...s} viewBox="0 0 24 24" className="shrink-0 text-droid-text-secondary" aria-hidden>
        <path
          fill="currentColor"
          d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654 2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
        />
      </svg>
    );

  if (provider === 'google')
    return (
      <svg {...s} viewBox="0 0 24 24" className="shrink-0" aria-hidden>
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
        />
      </svg>
    );

  if (provider === 'factory' || provider === 'default') return <FactoryMark size={size} />;

  // Brand marks below are vendored from lobehub/lobe-icons static SVGs
  // (MIT, (c) LobeHub) so provider icons render offline with no new deps.

  // Lobe Meta mark.
  if (provider === 'meta')
    return (
      <svg {...s} viewBox="0 0 24 24" className="shrink-0" aria-hidden>
        <path
          d="M6.897 4h-.024l-.031 2.615h.022c1.715 0 3.046 1.357 5.94 6.246l.175.297.012.02 1.62-2.438-.012-.019a48.763 48.763 0 00-1.098-1.716 28.01 28.01 0 00-1.175-1.629C10.413 4.932 8.812 4 6.896 4z"
          fill="url(#lobe-icons-meta-0-)"
        ></path>
        <path
          d="M6.873 4C4.95 4.01 3.247 5.258 2.02 7.17a4.352 4.352 0 00-.01.017l2.254 1.231.011-.017c.718-1.083 1.61-1.774 2.568-1.785h.021L6.896 4h-.023z"
          fill="url(#lobe-icons-meta-1-)"
        ></path>
        <path
          d="M2.019 7.17l-.011.017C1.2 8.447.598 9.995.274 11.664l-.005.022 2.534.6.004-.022c.27-1.467.786-2.828 1.456-3.845l.011-.017L2.02 7.17z"
          fill="url(#lobe-icons-meta-2-)"
        ></path>
        <path
          d="M2.807 12.264l-2.533-.6-.005.022c-.177.918-.267 1.851-.269 2.786v.023l2.598.233v-.023a12.591 12.591 0 01.21-2.44z"
          fill="url(#lobe-icons-meta-3-)"
        ></path>
        <path
          d="M2.677 15.537a5.462 5.462 0 01-.079-.813v-.022L0 14.468v.024a8.89 8.89 0 00.146 1.652l2.535-.585a4.106 4.106 0 01-.004-.022z"
          fill="url(#lobe-icons-meta-4-)"
        ></path>
        <path
          d="M3.27 16.89c-.284-.31-.484-.756-.589-1.328l-.004-.021-2.535.585.004.021c.192 1.01.568 1.85 1.106 2.487l.014.017 2.018-1.745a2.106 2.106 0 01-.015-.016z"
          fill="url(#lobe-icons-meta-5-)"
        ></path>
        <path
          d="M10.78 9.654c-1.528 2.35-2.454 3.825-2.454 3.825-2.035 3.2-2.739 3.917-3.871 3.917a1.545 1.545 0 01-1.186-.508l-2.017 1.744.014.017C2.01 19.518 3.058 20 4.356 20c1.963 0 3.374-.928 5.884-5.33l1.766-3.13a41.283 41.283 0 00-1.227-1.886z"
          fill="#0082FB"
        ></path>
        <path
          d="M13.502 5.946l-.016.016c-.4.43-.786.908-1.16 1.416.378.483.768 1.024 1.175 1.63.48-.743.928-1.345 1.367-1.807l.016-.016-1.382-1.24z"
          fill="url(#lobe-icons-meta-6-)"
        ></path>
        <path
          d="M20.918 5.713C19.853 4.633 18.583 4 17.225 4c-1.432 0-2.637.787-3.723 1.944l-.016.016 1.382 1.24.016-.017c.715-.747 1.408-1.12 2.176-1.12.826 0 1.6.39 2.27 1.075l.015.016 1.589-1.425-.016-.016z"
          fill="#0082FB"
        ></path>
        <path
          d="M23.998 14.125c-.06-3.467-1.27-6.566-3.064-8.396l-.016-.016-1.588 1.424.015.016c1.35 1.392 2.277 3.98 2.361 6.971v.023h2.292v-.022z"
          fill="url(#lobe-icons-meta-7-)"
        ></path>
        <path
          d="M23.998 14.15v-.023h-2.292v.022c.004.14.006.282.006.424 0 .815-.121 1.474-.368 1.95l-.011.022 1.708 1.782.013-.02c.62-.96.946-2.293.946-3.91 0-.083 0-.165-.002-.247z"
          fill="url(#lobe-icons-meta-8-)"
        ></path>
        <path
          d="M21.344 16.52l-.011.02c-.214.402-.519.67-.917.787l.778 2.462a3.493 3.493 0 00.438-.182 3.558 3.558 0 001.366-1.218l.044-.065.012-.02-1.71-1.784z"
          fill="url(#lobe-icons-meta-9-)"
        ></path>
        <path
          d="M19.92 17.393c-.262 0-.492-.039-.718-.14l-.798 2.522c.449.153.927.222 1.46.222.492 0 .943-.073 1.352-.215l-.78-2.462c-.167.05-.341.075-.517.073z"
          fill="url(#lobe-icons-meta-10-)"
        ></path>
        <path
          d="M18.323 16.534l-.014-.017-1.836 1.914.016.017c.637.682 1.246 1.105 1.937 1.337l.797-2.52c-.291-.125-.573-.353-.9-.731z"
          fill="url(#lobe-icons-meta-11-)"
        ></path>
        <path
          d="M18.309 16.515c-.55-.642-1.232-1.712-2.303-3.44l-1.396-2.336-.011-.02-1.62 2.438.012.02.989 1.668c.959 1.61 1.74 2.774 2.493 3.585l.016.016 1.834-1.914a2.353 2.353 0 01-.014-.017z"
          fill="url(#lobe-icons-meta-12-)"
        ></path>
        <defs>
          <linearGradient
            id="lobe-icons-meta-0-"
            x1="75.897%"
            x2="26.312%"
            y1="89.199%"
            y2="12.194%"
          >
            <stop offset=".06%" stopColor="#0867DF"></stop>
            <stop offset="45.39%" stopColor="#0668E1"></stop>
            <stop offset="85.91%" stopColor="#0064E0"></stop>
          </linearGradient>
          <linearGradient
            id="lobe-icons-meta-1-"
            x1="21.67%"
            x2="97.068%"
            y1="75.874%"
            y2="23.985%"
          >
            <stop offset="13.23%" stopColor="#0064DF"></stop>
            <stop offset="99.88%" stopColor="#0064E0"></stop>
          </linearGradient>
          <linearGradient
            id="lobe-icons-meta-2-"
            x1="38.263%"
            x2="60.895%"
            y1="89.127%"
            y2="16.131%"
          >
            <stop offset="1.47%" stopColor="#0072EC"></stop>
            <stop offset="68.81%" stopColor="#0064DF"></stop>
          </linearGradient>
          <linearGradient id="lobe-icons-meta-3-" x1="47.032%" x2="52.15%" y1="90.19%" y2="15.745%">
            <stop offset="7.31%" stopColor="#007CF6"></stop>
            <stop offset="99.43%" stopColor="#0072EC"></stop>
          </linearGradient>
          <linearGradient
            id="lobe-icons-meta-4-"
            x1="52.155%"
            x2="47.591%"
            y1="58.301%"
            y2="37.004%"
          >
            <stop offset="7.31%" stopColor="#007FF9"></stop>
            <stop offset="100%" stopColor="#007CF6"></stop>
          </linearGradient>
          <linearGradient
            id="lobe-icons-meta-5-"
            x1="37.689%"
            x2="61.961%"
            y1="12.502%"
            y2="63.624%"
          >
            <stop offset="7.31%" stopColor="#007FF9"></stop>
            <stop offset="100%" stopColor="#0082FB"></stop>
          </linearGradient>
          <linearGradient
            id="lobe-icons-meta-6-"
            x1="34.808%"
            x2="62.313%"
            y1="68.859%"
            y2="23.174%"
          >
            <stop offset="27.99%" stopColor="#007FF8"></stop>
            <stop offset="91.41%" stopColor="#0082FB"></stop>
          </linearGradient>
          <linearGradient
            id="lobe-icons-meta-7-"
            x1="43.762%"
            x2="57.602%"
            y1="6.235%"
            y2="98.514%"
          >
            <stop offset="0%" stopColor="#0082FB"></stop>
            <stop offset="99.95%" stopColor="#0081FA"></stop>
          </linearGradient>
          <linearGradient id="lobe-icons-meta-8-" x1="60.055%" x2="39.88%" y1="4.661%" y2="69.077%">
            <stop offset="6.19%" stopColor="#0081FA"></stop>
            <stop offset="100%" stopColor="#0080F9"></stop>
          </linearGradient>
          <linearGradient
            id="lobe-icons-meta-9-"
            x1="30.282%"
            x2="61.081%"
            y1="59.32%"
            y2="33.244%"
          >
            <stop offset="0%" stopColor="#027AF3"></stop>
            <stop offset="100%" stopColor="#0080F9"></stop>
          </linearGradient>
          <linearGradient
            id="lobe-icons-meta-10-"
            x1="20.433%"
            x2="82.112%"
            y1="50.001%"
            y2="50.001%"
          >
            <stop offset="0%" stopColor="#0377EF"></stop>
            <stop offset="99.94%" stopColor="#0279F1"></stop>
          </linearGradient>
          <linearGradient
            id="lobe-icons-meta-11-"
            x1="40.303%"
            x2="72.394%"
            y1="35.298%"
            y2="57.811%"
          >
            <stop offset=".19%" stopColor="#0471E9"></stop>
            <stop offset="100%" stopColor="#0377EF"></stop>
          </linearGradient>
          <linearGradient
            id="lobe-icons-meta-12-"
            x1="32.254%"
            x2="68.003%"
            y1="19.719%"
            y2="84.908%"
          >
            <stop offset="27.65%" stopColor="#0867DF"></stop>
            <stop offset="100%" stopColor="#0471E9"></stop>
          </linearGradient>
        </defs>
      </svg>
    );

  // Lobe xAI/Grok mark.
  if (provider === 'xai')
    return (
      <svg
        {...s}
        viewBox="0 0 24 24"
        fill="currentColor"
        className="shrink-0 text-droid-text"
        aria-hidden
      >
        <path d="M6.469 8.776L16.512 23h-4.464L2.005 8.776H6.47zm-.004 7.9l2.233 3.164L6.467 23H2l4.465-6.324zM22 2.582V23h-3.659V7.764L22 2.582zM22 1l-9.952 14.095-2.233-3.163L17.533 1H22z"></path>
      </svg>
    );

  // Lobe Copilot mark.
  if (provider === 'copilot')
    return (
      <svg {...s} viewBox="0 0 24 24" className="shrink-0" aria-hidden>
        <path
          d="M17.533 1.829A2.528 2.528 0 0015.11 0h-.737a2.531 2.531 0 00-2.484 2.087l-1.263 6.937.314-1.08a2.528 2.528 0 012.424-1.833h4.284l1.797.706 1.731-.706h-.505a2.528 2.528 0 01-2.423-1.829l-.715-2.453z"
          fill="url(#lobe-icons-copilot-0-)"
          transform="translate(0 1)"
        ></path>
        <path
          d="M6.726 20.16A2.528 2.528 0 009.152 22h1.566c1.37 0 2.49-1.1 2.525-2.48l.17-6.69-.357 1.228a2.528 2.528 0 01-2.423 1.83h-4.32l-1.54-.842-1.667.843h.497c1.124 0 2.113.75 2.426 1.84l.697 2.432z"
          fill="url(#lobe-icons-copilot-1-)"
          transform="translate(0 1)"
        ></path>
        <path
          d="M15 0H6.252c-2.5 0-4 3.331-5 6.662-1.184 3.947-2.734 9.225 1.75 9.225H6.78c1.13 0 2.12-.753 2.43-1.847.657-2.317 1.809-6.359 2.713-9.436.46-1.563.842-2.906 1.43-3.742A1.97 1.97 0 0115 0"
          fill="url(#lobe-icons-copilot-2-)"
          transform="translate(0 1)"
        ></path>
        <path
          d="M15 0H6.252c-2.5 0-4 3.331-5 6.662-1.184 3.947-2.734 9.225 1.75 9.225H6.78c1.13 0 2.12-.753 2.43-1.847.657-2.317 1.809-6.359 2.713-9.436.46-1.563.842-2.906 1.43-3.742A1.97 1.97 0 0115 0"
          fill="url(#lobe-icons-copilot-3-)"
          transform="translate(0 1)"
        ></path>
        <path
          d="M9 22h8.749c2.5 0 4-3.332 5-6.663 1.184-3.948 2.734-9.227-1.75-9.227H17.22c-1.129 0-2.12.754-2.43 1.848a1149.2 1149.2 0 01-2.713 9.437c-.46 1.564-.842 2.907-1.43 3.743A1.97 1.97 0 019 22"
          fill="url(#lobe-icons-copilot-4-)"
          transform="translate(0 1)"
        ></path>
        <path
          d="M9 22h8.749c2.5 0 4-3.332 5-6.663 1.184-3.948 2.734-9.227-1.75-9.227H17.22c-1.129 0-2.12.754-2.43 1.848a1149.2 1149.2 0 01-2.713 9.437c-.46 1.564-.842 2.907-1.43 3.743A1.97 1.97 0 019 22"
          fill="url(#lobe-icons-copilot-5-)"
          transform="translate(0 1)"
        ></path>
        <defs>
          <radialGradient
            cx="85.44%"
            cy="100.653%"
            fx="85.44%"
            fy="100.653%"
            gradientTransform="scale(-.8553 -1) rotate(50.927 2.041 -1.946)"
            id="lobe-icons-copilot-0-"
            r="105.116%"
          >
            <stop offset="9.6%" stopColor="#00AEFF"></stop>
            <stop offset="77.3%" stopColor="#2253CE"></stop>
            <stop offset="100%" stopColor="#0736C4"></stop>
          </radialGradient>
          <radialGradient
            cx="18.143%"
            cy="32.928%"
            fx="18.143%"
            fy="32.928%"
            gradientTransform="scale(.8897 1) rotate(52.069 .193 .352)"
            id="lobe-icons-copilot-1-"
            r="95.612%"
          >
            <stop offset="0%" stopColor="#FFB657"></stop>
            <stop offset="63.4%" stopColor="#FF5F3D"></stop>
            <stop offset="92.3%" stopColor="#C02B3C"></stop>
          </radialGradient>
          <radialGradient
            cx="82.987%"
            cy="-9.792%"
            fx="82.987%"
            fy="-9.792%"
            gradientTransform="scale(-1 -.9441) rotate(-70.872 .142 1.17)"
            id="lobe-icons-copilot-4-"
            r="140.622%"
          >
            <stop offset="6.6%" stopColor="#8C48FF"></stop>
            <stop offset="50%" stopColor="#F2598A"></stop>
            <stop offset="89.6%" stopColor="#FFB152"></stop>
          </radialGradient>
          <linearGradient
            id="lobe-icons-copilot-2-"
            x1="39.465%"
            x2="46.884%"
            y1="12.117%"
            y2="103.774%"
          >
            <stop offset="15.6%" stopColor="#0D91E1"></stop>
            <stop offset="48.7%" stopColor="#52B471"></stop>
            <stop offset="65.2%" stopColor="#98BD42"></stop>
            <stop offset="93.7%" stopColor="#FFC800"></stop>
          </linearGradient>
          <linearGradient id="lobe-icons-copilot-3-" x1="45.949%" x2="50%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="#3DCBFF"></stop>
            <stop offset="24.7%" stopColor="#0588F7" stopOpacity="0"></stop>
          </linearGradient>
          <linearGradient
            id="lobe-icons-copilot-5-"
            x1="83.507%"
            x2="83.453%"
            y1="-6.106%"
            y2="21.131%"
          >
            <stop offset="5.8%" stopColor="#F8ADFA"></stop>
            <stop offset="70.8%" stopColor="#A86EDD" stopOpacity="0"></stop>
          </linearGradient>
        </defs>
      </svg>
    );

  // Lobe Junie mark.
  if (provider === 'junie')
    return (
      <svg {...s} viewBox="0 0 24 24" className="shrink-0" aria-hidden>
        <path
          d="M24 9.333C24 18.666 20 24 9.333 24H8v-8h1.333C14 16 16 14 16 9.333V8h8v1.333zM8 16H0V8h8v8zM16 8H8V0h8v8z"
          fill="#47E054"
        ></path>
      </svg>
    );

  // Lobe Kimi mark.
  if (provider === 'kimi')
    return (
      <svg
        {...s}
        viewBox="0 0 24 24"
        fill="currentColor"
        className="shrink-0 text-droid-text"
        aria-hidden
      >
        <path d="M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z"></path>
        <path d="M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z"></path>
      </svg>
    );

  // Lobe Mistral mark. Every Provider is handled above, so this is the
  // terminal branch, not a fallback: do not add a default case beneath it.
  return (
    <svg {...s} viewBox="0 0 24 24" className="shrink-0" aria-hidden>
      <path d="M3.428 3.4h3.429v3.428H3.428V3.4zm13.714 0h3.43v3.428h-3.43V3.4z" fill="gold"></path>
      <path
        d="M3.428 6.828h6.857v3.429H3.429V6.828zm10.286 0h6.857v3.429h-6.857V6.828z"
        fill="#FFAF00"
      ></path>
      <path d="M3.428 10.258h17.144v3.428H3.428v-3.428z" fill="#FF8205"></path>
      <path
        d="M3.428 13.686h3.429v3.428H3.428v-3.428zm6.858 0h3.429v3.428h-3.429v-3.428zm6.856 0h3.43v3.428h-3.43v-3.428z"
        fill="#FA500F"
      ></path>
      <path
        d="M0 17.114h10.286v3.429H0v-3.429zm13.714 0H24v3.429H13.714v-3.429z"
        fill="#E10500"
      ></path>
    </svg>
  );
}
