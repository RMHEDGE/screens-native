import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';
import { StyleSheet, View, Text, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMemo, useState } from 'react';
import Toast from 'react-native-toast-message';
import { useKeepAwake } from 'expo-keep-awake';

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
        setConfig(config);
        setState('displaying');
      }
    }

  }, [config]);

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
    paddingTop: Constants.statusBarHeight,
    display: 'flex',
    flex: 1
  },
  center: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1
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
      <View style={{ flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center', display: 'flex', flexDirection: 'column' }}>
        <Text>What is this screen's ID?</Text>
        <TextInput
          style={{ marginTop: 10, outlineWidth: 1, outlineStyle: 'solid', outlineColor: 'cornflowerblue' }}
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

const getConfig = async (): Promise<Config | null> => {
  try {
    const config = await AsyncStorage.getItem('config');
    return config == null ? null : JSON.parse(config);
  } catch (e) {
    return null;
  }
}

const storeConfig = async (c: Config) =>
  AsyncStorage.setItem('config', JSON.stringify(c));