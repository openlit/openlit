import { VaultOptions } from '../types';
export default class Vault {
    static getSecrets(options: VaultOptions): Promise<any>;
}
