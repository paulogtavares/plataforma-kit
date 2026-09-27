// o próprio kit usa a configuração que ele oferece aos módulos (compilada em dist/)
import { configuracaoEslint } from "./dist/eslint.js";

export default configuracaoEslint({ react: [], ignorar: ["coverage/**"] });
