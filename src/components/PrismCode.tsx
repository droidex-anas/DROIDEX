import { Fragment } from 'react';
import { Highlight, Prism } from 'prism-react-renderer';
import { CODE_THEME } from './codeTheme';

export default function PrismCode({ code, language }: { code: string; language: string }) {
  if (!(language in Prism.languages)) return code;
  return (
    <Highlight theme={CODE_THEME} code={code} language={language}>
      {({ tokens, getTokenProps }) =>
        tokens.map((line, lineIndex) => (
          <Fragment key={lineIndex}>
            {lineIndex > 0 && '\n'}
            {/* Prism gives an empty line a placeholder "\n" token; the join above
                already supplies that newline, so a copied selection stays exact. */}
            {line.map((token, tokenIndex) =>
              token.empty ? null : <span {...getTokenProps({ token })} key={tokenIndex} />,
            )}
          </Fragment>
        ))
      }
    </Highlight>
  );
}
