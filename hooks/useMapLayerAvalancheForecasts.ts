import {useQueries, useQueryClient} from '@tanstack/react-query';
import {ClientContext, ClientProps} from 'clientContext';
import AvalancheForecastQuery from 'hooks/useAvalancheForecast';
import {LoggerContext, LoggerProps} from 'loggerContext';
import React from 'react';
import {AvalancheCenter, AvalancheCenterID, MapLayer, Product} from 'types/nationalAvalancheCenter';
import {RequestedTime} from 'utils/date';

export const useMapLayerAvalancheForecasts = (center_id: AvalancheCenterID, requestedTime: RequestedTime, mapLayer: MapLayer, metadata: AvalancheCenter) => {
  const {logger} = React.useContext<LoggerProps>(LoggerContext);
  const queryClient = useQueryClient();
  const {nationalAvalancheCenterHost} = React.useContext<ClientProps>(ClientContext);
  const expiryTimeHours = metadata?.config?.expires_time;
  const expiryTimeZone = metadata?.timezone;

  return useQueries({
    queries: mapLayer
      ? mapLayer.features.map(feature => {
          return {
            queryKey: AvalancheForecastQuery.queryKey(nationalAvalancheCenterHost, center_id, feature.id, requestedTime, expiryTimeZone, expiryTimeHours),
            queryFn: async (): Promise<Product> =>
              AvalancheForecastQuery.fetch(queryClient, nationalAvalancheCenterHost, center_id, feature.id, requestedTime, expiryTimeZone, expiryTimeHours, logger),
            enabled: !!expiryTimeHours,
            cacheTime: 24 * 60 * 60 * 1000, // hold on to this cached data for a day (in milliseconds)
          };
        })
      : [],
  });
};
