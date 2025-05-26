import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';
import { StyleSheet, View, Text, TextInput, Platform, TVEventHandler, useTVEventHandler } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMemo, useState } from 'react';
import Toast from 'react-native-toast-message';
import { useKeepAwake } from 'expo-keep-awake';
import * as Updates from 'expo-updates';

type Config = {
  url: string,
  reload: number,
  onLoad: string,
} | Config[]

export default function App() {
  useKeepAwake();
  const [config, setConfig] = useState<Config>();
  const [state, setState] = useState<'startup' | 'loading' | 'needs-input' | 'displaying'>('startup');

  useMemo(async () => {

    if (state == 'startup') {
      const config = await getConfig();
      if (config == null) return setState('needs-input');
      else {
        setConfig(config[0]);
        setState('displaying');
      }
    }

  }, [config]);

  useTVEventHandler(async ({ eventType }) => {
    if (eventType === 'left') {
      Toast.show({
        type: 'info',
        text1: "Respringing"
      })

      await Updates.reloadAsync();
    } else if (eventType === 'right') {
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
          storeConfig(c)
            .catch(e => Toast.show({
              type: 'success',
              text1: "Saved config",
              text2: "On load, this screen will be configured"
            }))
            .catch(e => Toast.show({
              type: 'error',
              text1: "Failed to save config",
              text2: String(e)
            }));
        })
        .catch(e => {
          Toast.show({
            type: 'error',
            text1: "Failed to get config",
            text2: String(e),
          })
        })
    }
  });

  return (
    <View style={styles.container}>
      {(state == 'loading' || state == 'startup') && <Loader />}
      {state == 'displaying' && <Split config={config!} />}
      {state == 'needs-input' && <Form onConfig={(c) => {
        setConfig(c);
        setState('displaying');
        storeConfig(c)
          .catch(e => Toast.show({
            type: 'success',
            text1: "Saved config",
            text2: "On load, this screen will be configured"
          }))
          .catch(e => Toast.show({
            type: 'error',
            text1: "Failed to save config",
            text2: String(e)
          }));
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

function Split({ config }: { config: Config }) {
  if (!Array.isArray(config)) {
    return <WebView
      style={{ flex: 1 }}
      source={{ uri: config.url }}
      injectedJavaScript={[
        `(() => {${config.onLoad}})()`,
        `setTimeout(() => window.location.reload(), ${config.reload});`
      ].join('\n')} />
  } else {
    return (
      <View style={{ flex: 1, display: 'flex' }}>
        {config.map((c, index) => <Split key={index} config={c} />)}
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

function Form({ onConfig }: { onConfig: (c: Config) => void }) {
  const [id, setUrl] = useState('');

  const onSubmit = () => {
    Toast.show({
      type: 'info',
      text1: "Checking config..."
    });

    fetchConfig(id)
      .then(c => onConfig(c))
      .catch(e => {
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
    .then(v => v.json().then(v => ok(v)).catch(e => err("Invalid config format")))
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

const storeConfig = async (c: Config) => {
  AsyncStorage.setItem('config', JSON.stringify(c));
  AsyncStorage.setItem('id', JSON.stringify(c));
}
