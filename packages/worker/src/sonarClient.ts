import axios from 'axios';
import type { AxiosInstance } from 'axios';

let _client: AxiosInstance | null = null;

export function getSonarClient(): AxiosInstance {
  if (_client) return _client;

  const baseURL = process.env.SONAR_URL;
  const token = process.env.SONAR_TOKEN;

  if (!baseURL) throw new Error('SONAR_URL environment variable is required');
  if (!token) throw new Error('SONAR_TOKEN environment variable is required');

  _client = axios.create({
    baseURL,
    // SonarQube token auth: token as Basic username, empty password
    auth: { username: token, password: '' },
    timeout: 15_000,
  });

  return _client;
}
