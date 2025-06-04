import { WebView } from 'react-native-webview';
import { StyleSheet, View, Text, TextInput, Platform, useTVEventHandler } from 'react-native';
import { useMemo, useState } from 'react';
import { useKeepAwake } from 'expo-keep-awake';

import Constants from 'expo-constants';
import Toast from 'react-native-toast-message';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { LogClient } from './logs';
import { LogEntryData } from './logs/ty';

const LOGGER_ID = 'rm-displays';

type Config = {
  url: string,
  reload: number,
  onLoad: string,
} | Config[]


let logs = new LogClient({
  baseURL: 'https://logs.imflo.pet',
});


export default function App() {
  useKeepAwake();
  const [config, setConfig] = useState<Config>();
  const [state, setState] = useState<'startup' | 'loading' | 'needs-input' | 'displaying'>('startup');
  const [id, setId] = useState<string>();

  useMemo(async () => {

    if (state == 'startup') {
      const config = await getConfig();
      if (config == null) return setState('needs-input');
      else {
        logs.registerLogger(LOGGER_ID)
          .catch(() => { })
          .finally(() => {
            setId(config[1]);
            Toast.show({
              type: 'info',
              text1: 'Connected to logging service'
            });
            logs.sendLog(LOGGER_ID, config[1], {
              level: 'info',
              message: 'Logger connected',
            })
          });

        setConfig(config[0]);
        setState('displaying');
      }
    }

  }, [config]);

  useTVEventHandler(async ({ eventType }) => {
    console.log(eventType); // Should we need to know the names of things

    if (eventType === 'rewind') {
      Toast.show({
        type: 'info',
        text1: "Respringing"
      })

      await Updates.reloadAsync();
    } else if (eventType === 'fastForward') {
      Toast.show({
        type: 'info',
        text1: "Reloading Config"
      });

      const config = await getConfig();
      if (!config) return Toast.show({
        type: 'error',
        text1: "Sanity invalidated",
        text2: "Config became null while it was assumed to be valid"
      });

      fetchConfig(config[1])
        .then(c => {
          setConfig(c);
          setState('displaying');
          storeConfig(c, config[1])
            .then(() => Toast.show({
              type: 'success',
              text1: "Saved config",
              text2: "On load, this screen will be configured"
            }))
            .catch(e => {
              logs.sendLog(LOGGER_ID, config[1], {
                level: 'error',
                message: 'Error saving config',
                data: e
              });
              Toast.show({
                type: 'error',
                text1: "Failed to save config",
                text2: String(e)
              })
            });
        })
        .catch(e => {
          logs.sendLog(LOGGER_ID, config[1], {
            level: 'error',
            message: 'Error getting config',
            data: e
          });

          Toast.show({
            type: 'error',
            text1: `Failed to get config '${config[1]}'`,
            text2: String(e),
          })
        })
    }
  });

  return (
    <View style={styles.container}>
      {(state == 'loading' || state == 'startup') && <Loader />}
      {state == 'displaying' && <Split config={config!} logs={logs} id={id!} />}
      {state == 'needs-input' && <Form onConfig={(c, id) => {
        setConfig(c);
        setState('displaying');
        storeConfig(c, id)
          .then(e => Toast.show({
            type: 'success',
            text1: "Saved config",
            text2: "On load, this screen will be configured"
          }))
          .catch(e => {
            logs.sendLog(LOGGER_ID, id, {
              level: 'error',
              message: 'Error saving config',
              data: e
            });

            Toast.show({
              type: 'error',
              text1: "Failed to save config",
              text2: String(e)
            })
          });
      }} />}
      <Toast />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: Platform.isTV ? 0 : Constants.statusBarHeight,
    display: 'flex',
    flex: 1
  },
  center: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1
  },
  formContainer: {
    flex: 1,
    padding: Platform.isTV ? 40 : 20,
    alignItems: 'center',
    justifyContent: 'center',
    display: 'flex',
    flexDirection: 'column'
  },
  formText: {
    fontSize: Platform.isTV ? 32 : 16,
    marginBottom: Platform.isTV ? 20 : 10
  },
  input: {
    marginTop: Platform.isTV ? 20 : 10,
    outlineWidth: 1,
    outlineStyle: 'solid',
    outlineColor: 'cornflowerblue',
    fontSize: Platform.isTV ? 24 : 16,
    minWidth: Platform.isTV ? 300 : 200,
    padding: Platform.isTV ? 16 : 8
  }
});

function Split({ config, logs, id }: { config: Config, logs: LogClient, id: string }) {
  if (!Array.isArray(config)) {
    const script = [
      config.onLoad ? `(() => {${config.onLoad}})()` : '',
      `setTimeout(() => window.location.reload(), ${config.reload});`,
      `
        const consoleLog = (type, log) => window.ReactNativeWebView.postMessage(JSON.stringify({'type': 'Console', 'data': {'level': type, 'message': log}}));
        console = {
          log: (log) => consoleLog('info', log),
          debug: (log) => consoleLog('debug', log),
          info: (log) => consoleLog('info', log),
          warn: (log) => consoleLog('warn', log),
          error: (log) => consoleLog('error', log),
        };`
    ].filter(Boolean).join('\n');

    return <WebView
      ref={r => r?.injectJavaScript(script)}
      style={{ flex: 1 }}
      source={{ uri: config.url }}
      injectedJavaScript={script}
      allowsInlineMediaPlayback={true}
      allowsPictureInPictureMediaPlayback={true}
      originWhitelist={['*']}
      allowsProtectedMedia={true}
      userAgent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
      onMessage={m => {
        let payload: { type: string, data: LogEntryData } | undefined;
        try {
          payload = JSON.parse(m.nativeEvent.data);
          console.log(payload);
        } catch (e) { }

        if (payload) {
          if (payload.type === 'Console') {
            console.info(`[Console] ${JSON.stringify(payload.data)}`);
            logs.sendLog(LOGGER_ID, id, payload.data);
          }
        }
      }}
    />
  } else {
    return (
      <View style={{ flex: 1, display: 'flex' }}>
        {config.map((c, index) => <Split key={index} config={c} logs={logs} id={id} />)}
      </View>
    )
  }
}

function Loader() {
  return (
    <View style={styles.center}>
      <Text>
        I am loading look at me go!
      </Text>
    </View>
  )
}

function Form({ onConfig }: { onConfig: (c: Config, id: string) => void }) {
  const [id, setUrl] = useState('');

  const onSubmit = () => {
    Toast.show({
      type: 'info',
      text1: "Checking config..."
    });

    fetchConfig(id)
      .then(c => onConfig(c, id))
      .catch(e => {

        logs.sendLog(LOGGER_ID, id, {
          level: 'error',
          message: 'Error getting config',
          data: e
        });

        Toast.show({
          type: 'error',
          text1: "Failed to get config",
          text2: String(e),
        })
      })

  }

  return (
    <View style={styles.center}>
      <View style={styles.formContainer}>
        <Text style={styles.formText}>What is this screen's ID?</Text>
        <TextInput
          style={styles.input}
          onSubmitEditing={() => onSubmit()}
          onChangeText={txt => setUrl(txt)}
        />
      </View>
    </View>
  )
}

const fetchConfig = (id: string) => new Promise<Config>(async (ok, err) => {
  fetch(`https://raw.githubusercontent.com/RMHEDGE/rm-displays/refs/heads/main/${id}.json`)
    .then(v => v.json().then(v => ok(v)).catch(e => {
      logs.sendLog(LOGGER_ID, id, {
        level: 'error',
        message: 'Error loading config',
        data: e
      });

      err("Invalid config format");
    }))
    .catch(e => err("Invalid config ID"))
})

const getConfig = async (): Promise<[Config, string] | null> => {
  try {
    const config = await AsyncStorage.getItem('config');
    const id = await AsyncStorage.getItem('id');
    return (config == null || id == null) ? null : [JSON.parse(config), id];
  } catch (e) {
    return null;
  }
}

const storeConfig = async (c: Config, id: string) => {
  AsyncStorage.setItem('config', JSON.stringify(c));
  AsyncStorage.setItem('id', id);
}
