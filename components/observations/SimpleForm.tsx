import {AntDesign, MaterialIcons} from '@expo/vector-icons';
import {zodResolver} from '@hookform/resolvers/zod';
import {useBackHandler} from '@react-native-community/hooks';
import {useNavigation} from '@react-navigation/native';
import * as Sentry from '@sentry/react-native';
import {useMutation} from '@tanstack/react-query';
import {AxiosError} from 'axios';
import * as ImagePicker from 'expo-image-picker';
import _ from 'lodash';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FieldErrors, FormProvider, useForm, useWatch} from 'react-hook-form';
import {ColorValue, KeyboardAvoidingView, Platform, View as RNView, ScrollView, findNodeHandle} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {ClientContext, ClientProps} from 'clientContext';
import {Button} from 'components/content/Button';
import {Card} from 'components/content/Card';
import {QueryState, incompleteQueryState} from 'components/content/QueryState';
import {ImageList} from 'components/content/carousel/ImageList';
import {HStack, VStack, View} from 'components/core';
import {Conditional} from 'components/form/Conditional';
import {DateField} from 'components/form/DateField';
import {LocationField} from 'components/form/LocationField';
import {SelectField} from 'components/form/SelectField';
import {SwitchField} from 'components/form/SwitchField';
import {TextField} from 'components/form/TextField';
import {ObservationFormData, defaultObservationFormData, simpleObservationFormSchema} from 'components/observations/ObservationFormData';
import {UploaderState, getUploader} from 'components/observations/uploader/ObservationsUploader';
import {TaskStatus} from 'components/observations/uploader/Task';
import {Body, BodyBlack, BodySemibold, BodySm, Title3Semibold} from 'components/text';
import {useAvalancheCenterMetadata} from 'hooks/useAvalancheCenterMetadata';
import {LoggerContext, LoggerProps} from 'loggerContext';
import {usePostHog} from 'posthog-react-native';
import Toast from 'react-native-toast-message';
import {ObservationsStackNavigationProps} from 'routes';
import {colorLookup} from 'theme';
import {AvalancheCenterID, ImageMediaItem, InstabilityDistribution, MediaType, userFacingCenterId} from 'types/nationalAvalancheCenter';
import {startOfSeasonLocalDate} from 'utils/date';

const ImageListOverlay: React.FC<{index: number; onPress: (index: number) => void}> = ({index, onPress}) => {
  const onPressHandler = useCallback(() => {
    onPress(index);
  }, [index, onPress]);
  return (
    <View position="absolute" top={8} right={8}>
      <AntDesign.Button
        size={16}
        name="close"
        color="white"
        backgroundColor="rgba(0, 0, 0, 0.3)"
        iconStyle={{marginRight: 0}}
        style={{textAlign: 'center'}}
        onPress={onPressHandler}
      />
    </View>
  );
};

export const SimpleForm: React.FC<{
  center_id: AvalancheCenterID;
  onClose?: () => void;
}> = ({center_id, onClose}) => {
  const metadataResult = useAvalancheCenterMetadata(center_id);
  const metadata = metadataResult.data;
  const navigation = useNavigation<ObservationsStackNavigationProps>();
  const {logger} = React.useContext<LoggerProps>(LoggerContext);
  const formContext = useForm<ObservationFormData>({
    defaultValues: defaultObservationFormData(),
    resolver: zodResolver(simpleObservationFormSchema),
    mode: 'onBlur',
    shouldFocusError: false,
    shouldUnregister: true,
  });

  const postHog = usePostHog();

  postHog?.screen('observationForm', {
    center: center_id,
  });

  useEffect(() => {
    if (formContext && !metadata?.widget_config.observation_viewer?.require_approval) {
      formContext.setValue('status', 'published');
    }
  }, [formContext, metadata]);

  // When collapsing/cracking are toggled off, make sure the dependent fields are also cleared
  const collapsing = useWatch({control: formContext.control, name: 'instability.collapsing'});
  useEffect(() => {
    if (!collapsing) {
      formContext.setValue('instability.collapsing_description', undefined);
    }
  }, [collapsing, formContext]);
  const cracking = useWatch({control: formContext.control, name: 'instability.cracking'});
  useEffect(() => {
    if (!cracking) {
      formContext.setValue('instability.cracking_description', undefined);
    }
  }, [cracking, formContext]);

  const fieldRefs = useMemo(
    () => [
      {field: 'name', ref: React.createRef<RNView>()},
      {field: 'email', ref: React.createRef<RNView>()},
      {field: 'phone', ref: React.createRef<RNView>()},
      {field: 'activity', ref: React.createRef<RNView>()},
      {field: 'location_name', ref: React.createRef<RNView>()},
      {field: 'location_point', ref: React.createRef<RNView>()},
      {field: 'instability.cracking_description', ref: React.createRef<RNView>()},
      {field: 'instability.collapsing_description', ref: React.createRef<RNView>()},
      {field: 'avalanches_summary', ref: React.createRef<RNView>()},
      {field: 'observation_summary', ref: React.createRef<RNView>()},
    ],
    [],
  );
  const getFieldRef = useCallback((field: string) => fieldRefs.find(f => f.field === field)?.ref, [fieldRefs]);
  const scrollViewRef = useRef<ScrollView>(null);

  const {nationalAvalancheCenterHost} = React.useContext<ClientProps>(ClientContext);
  const today = new Date();

  const [imagePermissions] = ImagePicker.useMediaLibraryPermissions();
  const missingImagePermissions = imagePermissions !== null && !imagePermissions.granted && !imagePermissions.canAskAgain;

  const maxImageCount = 8;
  const [images, setImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const pickImage = useCallback(() => {
    void (async () => {
      try {
        // No permissions request is necessary for launching the image library
        const result = await ImagePicker.launchImageLibraryAsync({
          allowsMultipleSelection: true,
          exif: true,
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
          quality: 0.9,
          selectionLimit: maxImageCount - images.length,
        });

        if (!result.canceled) {
          const newImages = images.concat(result.assets).slice(0, maxImageCount);
          setImages(newImages);
        }
      } catch (error) {
        logger.error('ImagePicker error', {error});
        Sentry.captureMessage(`ImagePicker encountered an error: ${JSON.stringify(error)}`);
        // Are we offline? Things might be ok if they go online again.
        const {networkStatus} = getUploader().getState();
        Toast.show({
          type: 'error',
          text1:
            networkStatus === 'offline'
              ? `An unexpected error occurred when loading your images. Try again when you’re back online.`
              : `An unexpected error occurred when loading your images.`,
          position: 'bottom',
        });
      }
    })();
  }, [images, logger]);

  const removeImage = useCallback(
    (index: number) => {
      setImages(images.filter((_v, i) => i !== index));
    },
    [images, setImages],
  );
  const renderOverlay = useCallback((index: number) => <ImageListOverlay index={index} onPress={removeImage} />, [removeImage]);
  const renderAddImageButton = useCallback(
    ({textColor}: {textColor: ColorValue}) => (
      <HStack alignItems="center" space={4}>
        <MaterialIcons name="add" size={24} color={textColor} style={{marginTop: 1}} />
        <BodyBlack color={textColor}>Add images</BodyBlack>
      </HStack>
    ),
    [],
  );

  const mutation = useMutation<void, AxiosError, ObservationFormData>({
    mutationFn: async (observationFormData: ObservationFormData) => {
      logger.info({formValues: observationFormData}, 'submitting observation');
      const observationId = await getUploader().submitObservation({center_id, apiPrefix: nationalAvalancheCenterHost, observationFormData});
      const promise: Promise<void> = new Promise((resolve, reject) => {
        let lastObsStatus: TaskStatus | null = null;
        const listener = (uploaderState: UploaderState) => {
          const upload = uploaderState.observations.find(o => o.id === observationId);
          if (!upload) {
            // if it's not there, then it must be done
            if (lastObsStatus !== 'success') {
              logger.debug('observation submitted successfully!', {observationId});
              lastObsStatus = 'success';
              resolve();
              getUploader().unsubscribeFromStateUpdates(listener);
              Toast.show({
                type: 'success',
                text1: 'Thank you! Your observation has been submitted.',
                position: 'bottom',
              });
            }
            return;
          }
          if (upload.status !== lastObsStatus) {
            if (!lastObsStatus) {
              if (uploaderState.networkStatus === 'offline') {
                Toast.show({
                  type: 'info',
                  text1: 'You are currently offline. Your observation will automatically be submitted when you are back online.',
                  position: 'bottom',
                });
              } else {
                Toast.show({
                  type: 'info',
                  text1: 'Your observation has been captured, and is uploading now. Thank you!',
                  position: 'bottom',
                });
              }
            } else if (upload.status === 'error') {
              logger.debug('observation failed', {observationId});
              reject();
              getUploader().unsubscribeFromStateUpdates(listener);
              Toast.show({
                type: 'error',
                text1: `I'm sorry, there was an error uploading your observation. Please try again later.`,
                position: 'bottom',
              });
            }
            lastObsStatus = upload.status;
          }
        };
        getUploader().subscribeToStateUpdates(listener);
        listener(getUploader().getState());
      });
      return promise;
    },
    retry: true,
    // This mutation is always allowed to run! The uploader manages retries and persistence of this task
    networkMode: 'always',
  });

  const onSubmitHandler = useCallback(
    (data: ObservationFormData) => {
      // Submit button turns into a cancel button
      if (mutation.isLoading) {
        mutation.reset();
        return;
      }
      data.images = images;
      mutation.mutate(data);
    },
    [images, mutation],
  );

  const onSubmitErrorHandler = useCallback(
    (errors: FieldErrors<Partial<ObservationFormData>>) => {
      logger.error({errors: errors, formValues: formContext.getValues()}, 'submit error');
      // scroll to the first field with an error
      fieldRefs.some(({ref, field}) => {
        // field can be a nested path like `instability.collapsing_description`, so we use _.get to get the value
        if (_.get(errors, field) && scrollViewRef.current) {
          const handle = findNodeHandle(scrollViewRef.current);
          if (handle) {
            ref.current?.measureLayout(
              handle,
              (_left, top) => {
                if (scrollViewRef.current) {
                  scrollViewRef.current.scrollTo({y: top});
                }
              },
              () => undefined,
            );
            return true;
          }
        }
        return false;
      });
    },
    [fieldRefs, formContext, logger],
  );

  const onSubmitPress = useCallback(() => {
    void (async () => {
      // Force validation errors to show up on fields that haven't been visited yet
      await formContext.trigger();
      // Then try to submit the form
      void formContext.handleSubmit(onSubmitHandler, onSubmitErrorHandler)();
    })();
  }, [formContext, onSubmitHandler, onSubmitErrorHandler]);

  const onCloseHandler = useCallback(() => {
    formContext.reset();
    onClose ? onClose() : navigation.goBack();
  }, [formContext, navigation, onClose]);

  useBackHandler(() => {
    onCloseHandler();
    // Returning true marks the event as processed
    return true;
  });

  const formFieldSpacing = 16;
  const disableFormControls = mutation.isLoading || mutation.isSuccess;

  const phoneNumberTextTransform = useCallback((text: string): string => {
    const input = text.replace(/\D/g, '').substring(0, 10);
    const zip = input.substring(0, 3);
    const middle = input.substring(3, 6);
    const last = input.substring(6, 10);

    if (input.length > 6) {
      return `(${zip}) ${middle} - ${last}`;
    } else if (input.length > 3) {
      return `(${zip}) ${middle}`;
    } else if (input.length > 0) {
      return `(${zip}`;
    } else {
      return '';
    }
  }, []);

  if (incompleteQueryState(metadataResult) || !metadata) {
    return (
      <SafeAreaView edges={['top', 'left', 'right']}>
        <QueryState results={[metadataResult]} />;
      </SafeAreaView>
    );
  }

  return (
    <FormProvider {...formContext}>
      <View width="100%" height="100%" bg="#F6F8FC">
        {/* SafeAreaView shouldn't inset from bottom edge because TabNavigator is sitting there, or top edge since StackHeader is sitting there */}
        <SafeAreaView edges={['left', 'right']} style={{height: '100%', width: '100%'}}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex: 1, height: '100%'}}>
            <VStack style={{height: '100%', width: '100%'}} alignItems="stretch" bg="#F6F8FC">
              <ScrollView style={{height: '100%', width: '100%', backgroundColor: 'white'}} ref={scrollViewRef}>
                <VStack width="100%" justifyContent="flex-start" alignItems="stretch" pt={8} pb={8}>
                  <View px={16} pb={formFieldSpacing}>
                    <Body>Help keep the {userFacingCenterId(center_id)} community informed by submitting your observation.</Body>
                  </View>
                  <Card borderRadius={0} borderColor="white" header={<Title3Semibold>Privacy</Title3Semibold>}>
                    <VStack space={formFieldSpacing} mt={8}>
                      <SwitchField
                        name="private"
                        label="Observation visibility"
                        items={[
                          {label: 'Public', value: false},
                          {label: 'Private', value: true},
                        ]}
                        disabled={disableFormControls}
                      />
                      <SelectField
                        name="photoUsage"
                        label="Photo usage"
                        radio
                        items={[
                          {value: 'anonymous', label: 'Use anonymously'},
                          {value: 'credit', label: 'Use with photo credit'},
                          {value: 'private', label: "Don't use"},
                        ]}
                        disabled={disableFormControls}
                      />
                    </VStack>
                  </Card>
                  <Card borderRadius={0} borderColor="white" header={<Title3Semibold>General information</Title3Semibold>}>
                    <VStack space={formFieldSpacing} mt={8}>
                      <TextField
                        name="name"
                        label="Name"
                        textInputProps={{placeholder: 'Jane Doe', textContentType: 'name'}}
                        ref={getFieldRef('name')}
                        disabled={disableFormControls}
                      />
                      <SwitchField
                        name="show_name"
                        label="Show name to public?"
                        items={[
                          {label: 'Yes', value: true},
                          {label: 'No', value: false},
                        ]}
                        disabled={disableFormControls}
                      />
                      <TextField
                        name="email"
                        label="Email address"
                        comment="(never shared with the public)"
                        ref={getFieldRef('email')}
                        textInputProps={{
                          placeholder: 'you@domain.com',
                          textContentType: 'emailAddress',
                          keyboardType: 'email-address',
                          autoCapitalize: 'none',
                          autoCorrect: false,
                        }}
                        disabled={disableFormControls}
                      />
                      <TextField
                        name="phone"
                        label="Phone number"
                        comment="(optional, never shared with the public)"
                        textTransform={phoneNumberTextTransform}
                        ref={getFieldRef('phone')}
                        textInputProps={{
                          placeholder: '(012) 345-6789',
                          textContentType: 'telephoneNumber',
                          keyboardType: 'number-pad',
                          autoCapitalize: 'none',
                          autoCorrect: false,
                        }}
                        disabled={disableFormControls}
                      />
                      <DateField name="start_date" label="Observation date" minimumDate={startOfSeasonLocalDate(today)} maximumDate={today} disabled={disableFormControls} />
                      <SelectField
                        name="activity"
                        label="Activity"
                        prompt="What were you doing?"
                        ref={getFieldRef('activity')}
                        items={[
                          {
                            label: 'Skiing/Snowboarding',
                            value: 'skiing_snowboarding',
                          },
                          {
                            label: 'Snowmobiling/Snowbiking',
                            value: 'snowmobiling_snowbiking',
                          },
                          {
                            label: 'XC Skiing/Snowshoeing',
                            value: 'xcskiing_snowshoeing',
                          },
                          {
                            label: 'Climbing',
                            value: 'climbing',
                          },
                          {
                            label: 'Walking/Hiking',
                            value: 'walking',
                          },
                          {
                            label: 'Driving',
                            value: 'driving',
                          },
                          {
                            label: 'Other',
                            value: 'other',
                          },
                        ]}
                        disabled={disableFormControls}
                      />
                      <TextField
                        name="location_name"
                        label="Location"
                        ref={getFieldRef('location_name')}
                        textInputProps={{
                          placeholder: 'Please describe your observation location using common geographical place names (drainages, peak names, etc).',
                          multiline: true,
                        }}
                        disabled={disableFormControls}
                      />
                      <LocationField name="location_point" label="Latitude/Longitude" center={center_id} ref={getFieldRef('location_point')} disabled={disableFormControls} />
                    </VStack>
                  </Card>
                  <Card borderRadius={0} borderColor="white" header={<Title3Semibold>Signs of instability</Title3Semibold>}>
                    <VStack mt={8}>
                      <SwitchField
                        name="instability.avalanches_observed"
                        label="Did you see recent avalanches?"
                        items={[
                          {label: 'No', value: false},
                          {label: 'Yes', value: true},
                        ]}
                        pb={formFieldSpacing}
                        disabled={disableFormControls}
                      />
                      <Conditional name="instability.avalanches_observed" value={true}>
                        <VStack>
                          <View pb={formFieldSpacing}>
                            <Body fontStyle="italic">Please provide more detail in the Avalanches section below.</Body>
                          </View>
                          <SwitchField
                            name="instability.avalanches_triggered"
                            label="Did you trigger an avalanche?"
                            items={[
                              {label: 'No', value: false},
                              {label: 'Yes', value: true},
                            ]}
                            pb={formFieldSpacing}
                            disabled={disableFormControls}
                          />
                          <Conditional name="instability.avalanches_triggered" value={true}>
                            <SwitchField
                              name="instability.avalanches_caught"
                              label="Were you caught?"
                              items={[
                                {label: 'No', value: false},
                                {label: 'Yes', value: true},
                              ]}
                              pb={formFieldSpacing}
                              disabled={disableFormControls}
                            />
                          </Conditional>
                        </VStack>
                      </Conditional>
                      <SwitchField
                        name="instability.cracking"
                        label="Did you experience snowpack cracking?"
                        items={[
                          {label: 'No', value: false},
                          {label: 'Yes', value: true},
                        ]}
                        pb={formFieldSpacing}
                        disabled={disableFormControls}
                      />
                      <Conditional name="instability.cracking" value={true} space={formFieldSpacing}>
                        <SelectField
                          name="instability.cracking_description"
                          label="How widespread was the cracking?"
                          items={[
                            {value: InstabilityDistribution.Isolated, label: 'Isolated'},
                            {value: InstabilityDistribution.Specific, label: 'Specific'},
                            {value: InstabilityDistribution.Widespread, label: 'Widespread'},
                          ]}
                          prompt=" "
                          disabled={disableFormControls}
                          ref={getFieldRef('instability.cracking_description')}
                        />
                      </Conditional>
                      <SwitchField
                        name="instability.collapsing"
                        label="Did you experience snowpack collapsing?"
                        items={[
                          {label: 'No', value: false},
                          {label: 'Yes', value: true},
                        ]}
                        pb={formFieldSpacing}
                        disabled={disableFormControls}
                      />
                      <Conditional name="instability.collapsing" value={true} space={formFieldSpacing}>
                        <SelectField
                          name="instability.collapsing_description"
                          label="How widespread was the collapsing?"
                          items={[
                            {value: InstabilityDistribution.Isolated, label: 'Isolated'},
                            {value: InstabilityDistribution.Widespread, label: 'Widespread'},
                          ]}
                          prompt=" "
                          disabled={disableFormControls}
                          ref={getFieldRef('instability.collapsing_description')}
                        />
                      </Conditional>
                    </VStack>
                  </Card>
                  <Conditional name="instability.avalanches_observed" value={true}>
                    <Card borderRadius={0} borderColor="white" header={<Title3Semibold>Avalanches</Title3Semibold>}>
                      <VStack space={formFieldSpacing} mt={8}>
                        <TextField
                          name="avalanches_summary"
                          label="Observed avalanches"
                          ref={getFieldRef('avalanches_summary')}
                          textInputProps={{
                            placeholder: `• Location, aspect, and elevation
• How recently did it occur?
• Natural or triggered?
• Was anyone caught?
• Avalanche size, width, and depth`,
                            multiline: true,
                          }}
                          pb={formFieldSpacing}
                          disabled={disableFormControls}
                        />
                      </VStack>
                    </Card>
                  </Conditional>
                  <Card borderRadius={0} borderColor="white" header={<Title3Semibold>Field Notes</Title3Semibold>}>
                    <VStack space={formFieldSpacing} mt={8}>
                      <TextField
                        name="observation_summary"
                        label="What did you observe?"
                        ref={getFieldRef('observation_summary')}
                        textInputProps={{
                          placeholder: `• Signs of instability?
• Amount of new snow/total snow?
• Weather observations?
• Snowpack test results?
• How cautiously or aggressively did you travel?
• Overall impression of stability?`,
                          multiline: true,
                        }}
                        disabled={disableFormControls}
                      />
                    </VStack>
                  </Card>
                  <Card borderRadius={0} borderColor="white" header={<Title3Semibold>Photos</Title3Semibold>}>
                    <VStack space={formFieldSpacing} mt={8}>
                      <Body>You can add up to {maxImageCount} images.</Body>
                      {images.length > 0 && (
                        <ImageList
                          imageWidth={(4 * 140) / 3}
                          imageHeight={140}
                          media={images.map((i): ImageMediaItem => ({url: {original: i.uri, large: '', medium: '', thumbnail: ''}, type: MediaType.Image, caption: ''}))}
                          displayCaptions={false}
                          imageSize="original"
                          renderOverlay={renderOverlay}
                        />
                      )}
                      <VStack space={4}>
                        <Button
                          buttonStyle="normal"
                          onPress={pickImage}
                          disabled={images.length === maxImageCount || disableFormControls || missingImagePermissions}
                          renderChildren={renderAddImageButton}
                        />
                        {missingImagePermissions && (
                          <BodySm color={colorLookup('error.900')}>We need permission to access your photos to upload images. Please check your system settings.</BodySm>
                        )}
                      </VStack>
                    </VStack>
                  </Card>

                  <Button mx={16} mt={8} buttonStyle="primary" disabled={mutation.isSuccess || mutation.isLoading} busy={mutation.isLoading} onPress={onSubmitPress}>
                    <BodySemibold>{mutation.isLoading ? 'Uploading observation' : 'Submit your observation'}</BodySemibold>
                  </Button>
                  <VStack mx={16} mt={16} mb={32}>
                    {mutation.isSuccess && <Body>Thanks for your observation!</Body>}
                    {mutation.isError && <Body color={colorLookup('error.900')}>There was an error submitting your observation.</Body>}
                  </VStack>
                </VStack>
              </ScrollView>
            </VStack>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </FormProvider>
  );
};
