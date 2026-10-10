Framework baseado em Teoria dos Jogos para análise de viabilidade e equilíbrio em JCCs (estudo de caso: MTG Standard).

Fórmula: `PLS = α_cm × (wPT×PT + wIM×IM + wVG×VG)`

- Pesos padrão: `wPT=0.20, wIM=0.45, wVG=0.35`
- Limiar = média pura dos PLS das 19 banidas
- Fonte de dados: API Scryfall

## Uso

Abra `index.html` no navegador (precisa internet).

## Estrutura

- `index.html` — interface
- `style.css` — estilos
- `app.js` — cálculo PLS, IC, calibração
