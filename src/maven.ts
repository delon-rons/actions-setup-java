import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import * as constants from './constants';
import * as os from 'os';
import * as exec from '@actions/exec';
import * as io from '@actions/io';

export interface MavenOpts {
  caCert: string;
  keystore: string;
  password: string;
  settings: string;
  securitySettings: string;
  javaPath: string;
  javaVersion: string;
}

export function isValidOptions(mvnOpts: MavenOpts): boolean {
  return (
    mvnOpts.caCert !== '' &&
    mvnOpts.keystore !== '' &&
    mvnOpts.password !== '' &&
    mvnOpts.securitySettings !== '' &&
    mvnOpts.settings !== ''
  );
}

export async function setupMaven(opts: MavenOpts): Promise<void> {
  const settingsDir = path.join(
    core.getInput(constants.INPUT_SETTINGS_PATH) || os.homedir(),
    core.getInput(constants.INPUT_SETTINGS_PATH) ? '' : '.m2'
  );

  fs.writeFileSync(
    path.join(settingsDir, 'settings.xml'),
    btoa(opts.settings),
    {
      encoding: 'utf-8',
      flag: 'w'
    }
  );

  fs.writeFileSync(
    path.join(settingsDir, 'settings-security.xml'),
    btoa(opts.securitySettings),
    {
      encoding: 'utf-8',
      flag: 'w'
    }
  );

  const certDir = path.join(os.homedir(), 'certs');
  const rootCaPath = path.join(certDir, 'rootca.crt');
  await io.mkdirP(certDir);
  fs.writeFileSync(rootCaPath, btoa(opts.caCert), {
    encoding: 'utf-8',
    flag: 'w'
  });

  const p12Path = path.join(certDir, 'certificate.p12');
  fs.writeFileSync(p12Path, Buffer.from(opts.keystore, 'base64'));

  core.exportVariable(
    'MAVEN_OPTS',
    `-Djavax.net.ssl.keyStore=${p12Path} -Djavax.net.ssl.keyStoreType=pkcs12 -Djavax.net.ssl.keyStorePassword=${opts.password}`
  );

  var params: string[] = [
    '-storepass',
    'changeit',
    '-noprompt',
    '-alias',
    'mycert'
  ];

  // keytool for JAVA 8 has different API
  if (opts.javaVersion === '8') {
    params.push('-keystore', `${opts.javaPath}/jre/lib/security/cacerts`);
  } else {
    params.push('-cacerts');
  }

  var certexists = 0;
  try {
    const args = ['-list'].concat(params);
    certexists = await exec.exec(path.join(opts.javaPath, 'bin/keytool'), args);
  } catch (e) {
    const message = (e as Error).message;
    core.info(
      `keytool return an error: ${
        (e as Error).message
      } this is expected if the key is not in the keystore`
    );

    certexists =
      message && message.includes('Alias <mycert> does not exist') ? 1 : 0;
    core.info(
      `certexists has value ${certexists} and the message is ${message}`
    );
  }

  try {
    if (certexists !== 0) {
      core.info(`Importing the certificate!!`);
      await exec.exec(
        path.join(opts.javaPath, 'bin/keytool'),
        ['-importcert'].concat(params).concat(['-file', rootCaPath])
      );
    }
  } catch (e) {
    core.error(`keytool return an error: ${(e as Error).message}`);
  }

  core.debug(`added maven opts for MTLS access`);
}

const atob = function(str: string) {
  return Buffer.from(str, 'binary').toString('base64');
};

const btoa = function(str: string) {
  return Buffer.from(str, 'base64').toString('binary');
};
